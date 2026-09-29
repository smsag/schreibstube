/**
 * The SFTP side of publishing: a host key checked against a configured
 * fingerprint, and every write to a temporary name renamed over its target.
 */
import { createHash, randomBytes } from "node:crypto";
import Client from "ssh2-sftp-client";
import { withDeadline } from "../timeout.mjs";
import { joinRemote } from "./path.mjs";

/**
 * An SFTP failure with a wording the client may see. The full message is for
 * the operator's log: the library quotes the absolute path it was working on,
 * and the vault has no business learning where the web root lives.
 */
export class SftpError extends Error {
  constructor(message, { client = "SFTP failed." } = {}) {
    super(message);
    this.clientMessage = client;
  }
}

/** The one failure a person has to see word for word. */
export class HostKeyMismatchError extends SftpError {
  constructor(message) {
    super(message, { client: message });
  }
}

/**
 * A server pinged every ten seconds and given up on after three unanswered
 * pings, so a line that died without a FIN — a NAT that forgot it, a host
 * that rebooted — fails within the minute rather than never.
 */
export const KEEPALIVE_INTERVAL_MS = 10_000;
export const KEEPALIVE_COUNT_MAX = 3;

/** ssh2 reports a missing file as SFTP status 2, under several names. */
function isMissing(err) {
  const code = err?.code;
  return code === 2 || code === "ENOENT" || /no such file/i.test(err?.message ?? "");
}

/**
 * Whether the server said it lacks the POSIX rename extension: ssh2 refuses
 * up front when the server did not advertise it, and a server that did may
 * still answer status 8, `OP_UNSUPPORTED`.
 */
function isUnsupported(err) {
  return err?.code === 8 || /unsupported|does not support/i.test(err?.message ?? "");
}

/** OpenSSH prints `SHA256:` and drops the padding; accept it either way. */
export function fingerprintOf(key) {
  return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
}

/**
 * The algorithm a raw SSH public key blob names, such as `ssh-ed25519`.
 *
 * A server holds several host keys, and which one a client is shown depends
 * on the client: this library prefers ED25519, then ECDSA, then RSA. A
 * fingerprint read for another type can never match, so the mismatch says
 * which type was presented rather than leaving that to be guessed.
 */
export function keyTypeOf(key) {
  const blob = Buffer.isBuffer(key) ? key : Buffer.from(key ?? []);
  if (blob.length < 4) return "unknown";
  const length = blob.readUInt32BE(0);
  if (length === 0 || length > 64 || blob.length < 4 + length) return "unknown";
  const name = blob.subarray(4, 4 + length).toString("latin1");
  return /^[a-z0-9@.-]+$/i.test(name) ? name : "unknown";
}

export function fingerprintsMatch(presented, configured) {
  const normalise = (value) =>
    String(value)
      .trim()
      .replace(/^SHA256:/i, "")
      .replace(/=+$/, "");
  return normalise(presented) === normalise(configured);
}

export async function connect(target) {
  const client = new Client();
  let presented = null;
  let presentedType = null;

  try {
    await client.connect({
      host: target.host,
      port: target.port,
      username: target.user,
      ...(target.key ? { privateKey: target.key, passphrase: target.keyPassphrase } : {}),
      ...(target.password ? { password: target.password } : {}),
      readyTimeout: target.timeoutMs,
      keepaliveInterval: KEEPALIVE_INTERVAL_MS,
      keepaliveCountMax: KEEPALIVE_COUNT_MAX,
      hostVerifier: (key) => {
        presented = fingerprintOf(key);
        presentedType = keyTypeOf(key);
        return fingerprintsMatch(presented, target.fingerprint);
      }
    });
  } catch (err) {
    if (presented && !fingerprintsMatch(presented, target.fingerprint)) {
      throw new HostKeyMismatchError(
        `Host key mismatch for ${target.host}. Configured ${target.fingerprint}, ` +
          `server presented ${presentedType} ${presented}. Refusing to connect. ` +
          `A fingerprint read with ssh-keyscan must be the ${presentedType} one.`
      );
    }
    throw new SftpError(`Cannot reach ${target.host}: ${err.message}`, {
      client: "Cannot reach the SFTP host."
    });
  }

  return new Remote(client, target);
}

/**
 * One connection's operations, each under the target's deadline: a request
 * the server never answers would otherwise hold the per-target publish lock
 * for as long as the socket stays open, which with a dead peer is forever.
 */
export class Remote {
  constructor(client, target) {
    this.client = client;
    this.target = target;
    // Directories this connection has made sure of, as the promise that did
    // it: a site's pages share a handful of parents, and asking for each one
    // before every file was a round trip per file for nothing. Parallel writes
    // into one new directory wait for the same request instead of racing.
    this.directories = new Map();
    // Whether the server has the POSIX rename extension: unknown until the
    // first rename, then remembered so the fallback is not retried per file.
    this.posixRename = null;
  }

  /**
   * Call `callback` once when the connection closes, from either end, so a
   * shared connection the server hung up on is not handed out again.
   */
  onClose(callback) {
    let called = false;
    const once = () => {
      if (called) return;
      called = true;
      callback();
    };
    this.client.on("close", once);
    this.client.on("end", once);
  }

  async end() {
    try {
      await this.client.end();
    } catch {
      // A connection that cannot be closed cleanly is already gone.
    }
  }

  /** One library call under the deadline, named for the log. */
  bounded(operation, promise) {
    return withDeadline(promise, this.target.timeoutMs, `SFTP ${operation}`);
  }

  absolute(relative) {
    return joinRemote(this.target.root, relative);
  }

  stateAbsolute(relative) {
    return `${this.target.stateRoot.replace(/\/+$/, "")}/${relative}`;
  }

  /**
   * Write bytes to a path below the target root.
   *
   * Refuses to write through a symlink: following one would place a file
   * wherever the link points, which is outside everything this module checks.
   */
  async writeFile(relative, content) {
    return this.writeAbsolute(this.absolute(relative), content);
  }

  async writeAbsolute(path, content) {
    const kind = await this.exists(path);
    if (kind === "l") {
      throw new SftpError(`Refusing to write through a symlink: ${path}`, {
        client: "Refusing to write through a symlink."
      });
    }
    if (kind === "d") {
      throw new SftpError(`A directory is in the way: ${path}`, {
        client: "A directory is in the way of a file."
      });
    }

    await this.ensureDirectory(parentOf(path));

    const temporary = `${path}.schreibstube-${randomBytes(6).toString("hex")}`;
    await this.bounded("put", this.client.put(Buffer.from(content), temporary));
    try {
      await this.rename(temporary, path);
    } catch (err) {
      await this.removeAbsolute(temporary).catch(() => {});
      throw err;
    }
  }

  /** Create a directory and its parents, once per connection. */
  ensureDirectory(path) {
    let made = this.directories.get(path);
    if (!made) {
      // A failure here is not fatal, as it never was: the directory may exist
      // already, and a write into one that does not will fail on its own.
      made = this.bounded("mkdir", this.client.mkdir(path, true)).catch(() => {});
      this.directories.set(path, made);
    }
    return made;
  }

  /**
   * Rename over an existing file.
   *
   * Plain SFTP rename fails when the target exists, so the POSIX extension is
   * tried first: it replaces in one step, which is what makes the write atomic.
   * Servers without it get the two-step fallback and a window of milliseconds.
   * Only "without it" earns the fallback: any other refusal — a permission, a
   * dropped line — used to delete the target and then fail the rename too,
   * leaving the page gone rather than merely stale.
   */
  async rename(from, to) {
    if (this.posixRename !== false) {
      try {
        await this.bounded("posixRename", this.client.posixRename(from, to));
        this.posixRename = true;
        return;
      } catch (err) {
        if (!isUnsupported(err)) throw err;
        this.posixRename = false;
      }
    }
    await this.removeAbsolute(to).catch(() => {});
    await this.bounded("rename", this.client.rename(from, to));
  }

  /** False, "d", "-" or "l", as the client reports it. */
  async exists(path) {
    return this.bounded("exists", this.client.exists(path));
  }

  async readFile(path) {
    const buffer = await this.bounded("get", this.client.get(path));
    return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  }

  /**
   * A JSON file the bridge keeps for itself, or null when there is none.
   *
   * Absent means null; anything else is raised. The manifest decides what may
   * be deleted, so a read that failed for a reason other than "no such file" —
   * a permission, a dropped connection — used to be read as an empty manifest:
   * the commit then wrote a fresh one naming only this build, and every page
   * an earlier one had published became a file nothing knew about and nothing
   * would ever remove.
   */
  async readJson(path) {
    let text;
    try {
      text = (await this.readFile(path)).toString("utf8");
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }

    try {
      return JSON.parse(text);
    } catch {
      // Present but not JSON is a file this bridge did not write. Starting
      // over is the only thing it can do with one.
      return null;
    }
  }

  /**
   * The names in a directory; an absent directory has none. Any other
   * failure is raised: read as "empty", a permission problem on the source
   * directory made every commit report the sources missing, and one on the
   * web root made diagnostics report a site that could not be written.
   */
  async listNames(path) {
    try {
      return (await this.bounded("list", this.client.list(path))).map((entry) => entry.name);
    } catch (err) {
      if (isMissing(err)) return [];
      throw err;
    }
  }

  async remove(relative) {
    await this.removeAbsolute(this.absolute(relative));
  }

  async removeAbsolute(path) {
    await this.bounded("delete", this.client.delete(path, true));
  }

  /**
   * Remove directories left empty by a deletion, deepest first.
   *
   * Bounded by the target root: the loop stops as soon as a directory is not
   * empty, and never considers the root itself.
   */
  async pruneEmptyDirectories(relativePaths) {
    const candidates = new Set();
    for (const path of relativePaths) {
      const segments = path.split("/");
      segments.pop();
      while (segments.length > 0) {
        candidates.add(segments.join("/"));
        segments.pop();
      }
    }

    const deepestFirst = [...candidates].sort((a, b) => b.split("/").length - a.split("/").length);

    let pruned = 0;
    for (const directory of deepestFirst) {
      const absolute = this.absolute(`${directory}/x.html`).replace(/\/x\.html$/, "");
      let entries;
      try {
        entries = await this.listNames(absolute);
      } catch {
        // The site is written by now; a directory that cannot be listed is
        // left as it is rather than failing the publish over it.
        continue;
      }
      if (entries.length > 0) continue;
      try {
        await this.bounded("rmdir", this.client.rmdir(absolute));
        // Gone now, so a later write on this connection has to make it again.
        this.directories.delete(absolute);
        pruned += 1;
      } catch {
        // Busy, gone, or not ours to remove. Either way, not worth failing over.
      }
    }
    return pruned;
  }
}

function parentOf(path) {
  const at = path.lastIndexOf("/");
  return at <= 0 ? "/" : path.slice(0, at);
}
