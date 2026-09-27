/**
 * A real SFTP server over a temporary directory, for tests.
 *
 * Publishing is mostly a story about what happens on someone else's disk:
 * atomic renames, deletions, pruned directories, a manifest written last. None
 * of that is provable against a mock of our own transport, so the tests drive
 * an actual SSH connection into an actual server and then look at the files.
 *
 * Only the operations the bridge uses are implemented, and only well enough to
 * serve one client at a time on a local socket.
 */
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readdir, rename, rm, rmdir, stat, unlink } from "node:fs/promises";
import { createHash, generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ssh2 from "ssh2";

const { Server, utils } = ssh2;
const STATUS = ssh2.utils.sftp.STATUS_CODE;
const OPEN_MODE = ssh2.utils.sftp.OPEN_MODE;

/**
 * `latencyMs` delays every SFTP request before it is answered, as the distance
 * to a real host does; `stats` counts requests by type and records the paths
 * opened for reading, so a test can say what a publish cost in round trips
 * rather than in milliseconds, which a busy machine would make flaky.
 */
export async function startSftpServer({ user = "web", password = "geheim", latencyMs = 0 } = {}) {
  const stats = { requests: {}, reads: [] };
  const root = await mkdtemp(join(tmpdir(), "schreibstube-sftp-"));
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "pkcs1", format: "pem" }
  });

  const parsed = utils.parseKey(privateKey);
  const fingerprint = `SHA256:${createHash("sha256")
    .update(parsed.getPublicSSH())
    .digest("base64")
    .replace(/=+$/, "")}`;

  let connections = 0;
  const clients = new Set();
  const server = new Server({ hostKeys: [privateKey] }, (client) => {
    connections += 1;
    clients.add(client);
    client.on("close", () => clients.delete(client));
    client
      .on("authentication", (context) => {
        const ok =
          context.username === user &&
          (context.method === "password" ? context.password === password : false);
        return ok ? context.accept() : context.reject(["password"]);
      })
      .on("ready", () => {
        client.on("session", (accept) => {
          accept()
            .on("sftp", (acceptSftp) => serve(acceptSftp(), root, { latencyMs, stats }))
            .on("error", () => {});
        });
      })
      .on("error", () => {});
  });

  await new Promise((done) => server.listen(0, "127.0.0.1", done));

  return {
    root,
    port: server.address().port,
    fingerprint,
    user,
    password,
    stats,
    /** Start counting afresh, for the publish about to be measured. */
    resetStats() {
      stats.requests = {};
      stats.reads = [];
    },
    /** Every request counted since the last reset. */
    get requestCount() {
      return Object.values(stats.requests).reduce((sum, n) => sum + n, 0);
    },
    /** SSH connections opened so far, each one a login. */
    get connections() {
      return connections;
    },
    async stop() {
      // The bridge keeps an idle connection open for a while, and close()
      // waits for every connection to go; the fixture hangs up itself.
      for (const client of clients) client.end();
      await new Promise((done) => server.close(done));
      await rm(root, { recursive: true, force: true });
    }
  };
}

function serve(channel, root, { latencyMs, stats }) {
  const handles = new Map();
  let next = 0;

  // Every handler below is registered through this: it counts the request and,
  // with a latency set, answers it that much later.
  const sftp = {
    on(event, handler) {
      channel.on(event, (...args) => {
        stats.requests[event] = (stats.requests[event] ?? 0) + 1;
        if (latencyMs > 0) setTimeout(() => handler(...args), latencyMs);
        else handler(...args);
      });
    },
    handle: (...args) => channel.handle(...args),
    status: (...args) => channel.status(...args),
    data: (...args) => channel.data(...args),
    name: (...args) => channel.name(...args),
    attrs: (...args) => channel.attrs(...args)
  };

  const open = (value) => {
    const id = Buffer.alloc(4);
    id.writeUInt32BE(next, 0);
    handles.set(next, value);
    next += 1;
    return id;
  };
  const lookup = (handle) => handles.get(handle.readUInt32BE(0));

  /** Every path is confined to the fixture's directory. */
  const real = (path) => {
    const full = resolve(root, `.${path.startsWith("/") ? path : `/${path}`}`);
    return full.startsWith(root) ? full : root;
  };

  sftp.on("REALPATH", (id, path) => {
    const full = path === "." || path === "" ? "/" : path;
    sftp.name(id, [{ filename: full, longname: full, attrs: {} }]);
  });

  sftp.on("OPEN", async (id, path, flags) => {
    const full = real(path);
    const writing = Boolean(flags & (OPEN_MODE.WRITE | OPEN_MODE.TRUNC | OPEN_MODE.CREAT));
    try {
      if (writing) {
        await mkdir(join(full, ".."), { recursive: true });
        sftp.handle(id, open({ stream: createWriteStream(full), path: full }));
      } else {
        await stat(full);
        stats.reads.push(path);
        sftp.handle(id, open({ stream: createReadStream(full), path: full, reading: true }));
      }
    } catch {
      sftp.status(id, STATUS.NO_SUCH_FILE);
    }
  });

  sftp.on("WRITE", (id, handle, offset, data) => {
    const entry = lookup(handle);
    if (!entry) return sftp.status(id, STATUS.FAILURE);
    entry.stream.write(data, () => sftp.status(id, STATUS.OK));
  });

  sftp.on("READ", (id, handle, offset, length) => {
    const entry = lookup(handle);
    if (!entry) return sftp.status(id, STATUS.FAILURE);
    entry.buffer ??= null;

    readAll(entry).then((buffer) => {
      if (offset >= buffer.length) return sftp.status(id, STATUS.EOF);
      sftp.data(id, buffer.subarray(offset, Math.min(offset + length, buffer.length)));
    });
  });

  sftp.on("CLOSE", (id, handle) => {
    const entry = lookup(handle);
    if (entry?.stream && !entry.reading) {
      entry.stream.end(() => sftp.status(id, STATUS.OK));
      return;
    }
    entry?.stream?.destroy?.();
    sftp.status(id, STATUS.OK);
  });

  sftp.on("OPENDIR", async (id, path) => {
    try {
      const entries = await readdir(real(path), { withFileTypes: true });
      sftp.handle(id, open({ entries, index: 0, base: real(path) }));
    } catch {
      sftp.status(id, STATUS.NO_SUCH_FILE);
    }
  });

  sftp.on("READDIR", async (id, handle) => {
    const entry = lookup(handle);
    if (!entry?.entries) return sftp.status(id, STATUS.FAILURE);
    if (entry.index >= entry.entries.length) return sftp.status(id, STATUS.EOF);

    const names = [];
    for (const item of entry.entries.slice(entry.index)) {
      const attrs = await attributes(join(entry.base, item.name));
      names.push({
        filename: item.name,
        longname: `${item.isDirectory() ? "d" : "-"}rw-r--r-- 1 u u ${attrs.size} ${item.name}`,
        attrs
      });
    }
    entry.index = entry.entries.length;
    sftp.name(id, names);
  });

  const statHandler = async (id, path) => {
    try {
      sftp.attrs(id, await attributes(real(path)));
    } catch {
      sftp.status(id, STATUS.NO_SUCH_FILE);
    }
  };
  sftp.on("STAT", statHandler);
  sftp.on("LSTAT", statHandler);

  sftp.on("FSTAT", async (id, handle) => {
    const entry = lookup(handle);
    if (!entry?.path) return sftp.status(id, STATUS.FAILURE);
    await statHandler(id, entry.path.slice(root.length) || "/");
  });

  sftp.on("MKDIR", async (id, path) => {
    try {
      await mkdir(real(path), { recursive: true });
      sftp.status(id, STATUS.OK);
    } catch {
      sftp.status(id, STATUS.FAILURE);
    }
  });

  sftp.on("RMDIR", async (id, path) => {
    try {
      await rmdir(real(path));
      sftp.status(id, STATUS.OK);
    } catch {
      sftp.status(id, STATUS.FAILURE);
    }
  });

  sftp.on("REMOVE", async (id, path) => {
    try {
      await unlink(real(path));
      sftp.status(id, STATUS.OK);
    } catch {
      sftp.status(id, STATUS.NO_SUCH_FILE);
    }
  });

  // Plain SFTP rename, which fails when the target exists. The POSIX extension
  // is deliberately not implemented: the bridge has to work against servers
  // that lack it, so the tests run against one.
  sftp.on("RENAME", async (id, from, to) => {
    try {
      await stat(real(to));
      sftp.status(id, STATUS.FAILURE);
    } catch {
      try {
        await rename(real(from), real(to));
        sftp.status(id, STATUS.OK);
      } catch {
        sftp.status(id, STATUS.FAILURE);
      }
    }
  });
}

async function readAll(entry) {
  entry.promise ??= new Promise((done, fail) => {
    const chunks = [];
    entry.stream.on("data", (chunk) => chunks.push(chunk));
    entry.stream.on("end", () => done(Buffer.concat(chunks)));
    entry.stream.on("error", fail);
  });
  return entry.promise;
}

async function attributes(path) {
  const info = await stat(path);
  return {
    mode: info.mode,
    uid: 0,
    gid: 0,
    size: info.size,
    atime: Math.floor(info.atimeMs / 1000),
    mtime: Math.floor(info.mtimeMs / 1000)
  };
}
