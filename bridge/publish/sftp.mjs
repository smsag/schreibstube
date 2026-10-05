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

/** A line slower than this is not one a publish can be expected to finish on. */
const MIN_TRANSFER_BYTES_PER_SECOND = 128 * 1024;
/** The largest file read back from the host, for the read deadline. */
const MAX_READ_BYTES = 32 * 1024 * 1024;

/**
 * Work that was given up on — its request ran out of time — asking for one
 * more operation. Raised before the operation starts, so a publish abandoned
 * while a second one has begun cannot write a byte more.
 */
export class AbandonedError extends SftpError {
  constructor() {
    super("The publish was abandoned; no further operation is sent.", {
      client: "The publish was abandoned."
    });
    this.name = "AbandonedError";
  }
}

/**
 * One connection's operations, each under the target's deadline: a request
 * the server never answers would otherwise hold the per-target publish lock
 * for as long as the socket stays open, which with a dead peer is forever.
 *
 * Every operation goes through `bounded`, which is also where a request that
 * was abandoned stops: `withSignal` hands a request its own view of the shared
 * connection, and once that request's signal fires, the view refuses to start
 * anything.
 */
export class Remote {
  constructor(client, target) {
    this.client = client;
    this.target = target;
    this.signal = null;
    // Shared by every view of this connection.
    this.shared = {
      // Directories this connection has made sure of — real directories, not
      // links — as the promise that did it: a site's pages share a handful of
      // parents, and asking for each one before every file was a round trip
      // per file for nothing. Parallel writes into one new directory wait for
      // the same request instead of racing.
      directories: new Map(),
      // Whether the server has the POSIX rename extension: unknown until the
      // first rename, then remembered so the fallback is not retried per file.
      posixRename: null,
      destroyed: false
    };
  }

  get posixRename() {
    return this.shared.posixRename;
  }

  set posixRename(value) {
    this.shared.posixRename = value;
  }

  /** This connection, for one request: it stops when `signal` fires. */
  withSignal(signal) {
    const view = Object.create(this);
    view.signal = signal;
    return view;
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

  /**
   * Close the socket now, without the goodbye `end` waits for. An operation
   * the server is still holding fails at once instead of landing later.
   */
  destroy() {
    this.shared.destroyed = true;
    try {
      this.client.client?.destroy?.();
    } catch {
      // Already closed.
    }
    void this.end();
  }

  /** One library call under the deadline, named for the log; none once abandoned. */
  bounded(operation, start, extraMs = 0) {
    if (this.shared.destroyed || this.signal?.aborted) {
      return Promise.reject(new AbandonedError());
    }
    return withDeadline(start(), this.target.timeoutMs + extraMs, `SFTP ${operation}`);
  }

  /**
   * How much longer than a round trip a transfer of `bytes` may take.
   *
   * The operation deadline is sized for a listing or a rename. A put is one
   * promise for the whole file, and a video over a shared host's line is
   * minutes, not seconds; cutting it at the round-trip budget made the
   * upload budget the README promises unreachable.
   */
  transferAllowanceMs(bytes) {
    return Math.ceil((bytes / MIN_TRANSFER_BYTES_PER_SECOND) * 1000);
  }

  absolute(relative) {
    return joinRemote(this.target.root, relative);
  }

  stateAbsolute(relative) {
    return `${this.target.stateRoot.replace(/\/+$/, "")}/${relative}`;
  }

  /**
   * The configured root a path lies under: the state root when it is the
   * closer one, as it is when the state sits inside the web root.
   */
  rootOf(path) {
    const roots = [this.target.stateRoot, this.target.root]
      .filter(Boolean)
      .map((root) => root.replace(/\/+$/, ""))
      .sort((a, b) => b.length - a.length);
    const root = roots.find((candidate) => path.startsWith(`${candidate}/`));
    if (root === undefined) {
      throw new SftpError(`Outside every root: ${path}`, { client: "A path left the site." });
    }
    return root;
  }

  /**
   * Make sure every directory between the root and `path` is a directory, and
   * not a link to one. Only the last component used to be looked at, so a
   * linked parent — `assets` pointing at another site, or at the home
   * directory — carried a write wherever it led. `create` makes the missing
   * ones, one at a time, each looked at again once made. Without it, the
   * answer is whether they all exist.
   */
  async verifyParents(path, { create = false } = {}) {
    const root = this.rootOf(path);
    const segments = path.slice(root.length + 1).split("/");
    segments.pop();
    let current = root;
    for (const segment of segments) {
      current = `${current}/${segment}`;
      if (!(await this.directory(current, create))) return false;
    }
    return true;
  }

  /** Whether `path` is a real directory, made first when `create` asks for it. */
  async directory(path, create) {
    const known = this.shared.directories.get(path);
    if (known && ((await known.catch(() => false)) || !create)) return known;

    const check = this.inspectDirectory(path, create);
    this.shared.directories.set(path, check);
    // Only a directory that is there is remembered.
    const forget = () => {
      if (this.shared.directories.get(path) === check) this.shared.directories.delete(path);
    };
    check.then((present) => present || forget(), forget);
    return check;
  }

  async inspectDirectory(path, create) {
    let kind = await this.exists(path);
    if (kind === false && create) {
      // Refused when it raced another request making the same directory,
      // which is fine; anything else shows in the look that follows.
      await this.bounded("mkdir", () => this.client.mkdir(path)).catch((err) => {
        if (err instanceof AbandonedError) throw err;
      });
      kind = await this.exists(path);
    }
    if (kind === "l") {
      throw new SftpError(`Refusing to follow a linked directory: ${path}`, {
        client: "Refusing to follow a linked directory."
      });
    }
    if (kind === false) {
      if (!create) return false;
      throw new SftpError(`Cannot create the directory ${path}`, {
        client: "Cannot create a directory."
      });
    }
    if (kind !== "d") {
      throw new SftpError(`A file is in the way of a directory: ${path}`, {
        client: "A file is in the way of a directory."
      });
    }
    return true;
  }

  /**
   * Write bytes to a path below the target root.
   *
   * Refuses to write through a symlink, at the file or at any directory
   * above it: following one would place a file wherever the link points,
   * which is outside everything this module checks.
   */
  async writeFile(relative, content) {
    return this.writeAbsolute(this.absolute(relative), content);
  }

  async writeAbsolute(path, content) {
    await this.verifyParents(path, { create: true });
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

    const temporary = `${path}.schreibstube-${randomBytes(6).toString("hex")}`;
    const bytes = Buffer.from(content);
    await this.bounded(
      "put",
      () => this.client.put(bytes, temporary),
      this.transferAllowanceMs(bytes.length)
    );
    try {
      await this.rename(temporary, path);
    } catch (err) {
      await this.unlink(temporary).catch(() => {});
      throw err;
    }
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
        await this.bounded("posixRename", () => this.client.posixRename(from, to));
        this.posixRename = true;
        return;
      } catch (err) {
        if (!isUnsupported(err)) throw err;
        this.posixRename = false;
      }
    }
    await this.unlink(to).catch(() => {});
    await this.bounded("rename", () => this.client.rename(from, to));
  }

  /** False, "d", "-" or "l", as the client reports it. */
  async exists(path) {
    return this.bounded("exists", () => this.client.exists(path));
  }

  /** The size of a file, as the link itself reports it. */
  async sizeOf(path) {
    const info = await this.bounded("lstat", () => this.client.lstat(path));
    return info.size;
  }

  async readFile(path) {
    // A read's size is unknown until it arrives; a page or a manifest is small,
    // and the largest thing read back is a source at its own upload limit.
    const buffer = await this.bounded(
      "get",
      () => this.client.get(path),
      this.transferAllowanceMs(MAX_READ_BYTES)
    );
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
      const entries = await this.bounded("list", () => this.client.list(path));
      return entries.map((entry) => entry.name);
    } catch (err) {
      if (isMissing(err)) return [];
      throw err;
    }
  }

  async remove(relative) {
    await this.removeAbsolute(this.absolute(relative));
  }

  /**
   * Delete a file the bridge wrote. A linked directory above it, or a link
   * where the file was, is refused: neither is something the bridge made, and
   * the first would delete whatever lies at the other end.
   */
  async removeAbsolute(path) {
    if ((await this.verifyParents(path)) && (await this.exists(path)) === "l") {
      throw new SftpError(`Refusing to delete a symlink: ${path}`, {
        client: "Refusing to delete a symlink."
      });
    }
    await this.unlink(path);
  }

  /** The bare deletion, for a path this connection has just checked or made. */
  async unlink(path) {
    await this.bounded("delete", () => this.client.delete(path, true));
  }

  /**
   * Remove directories left empty by a deletion, deepest first.
   *
   * Bounded by the target root: the loop stops as soon as a directory is not
   * empty, and never considers the root itself. A directory that is a link,
   * or is reached through one, is left alone.
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
        if (!(await this.verifyParents(`${absolute}/x`))) continue;
        entries = await this.listNames(absolute);
      } catch (err) {
        if (err instanceof AbandonedError) throw err;
        // The site is written by now; a directory that cannot be listed, or
        // is a link, is left as it is rather than failing the publish over it.
        continue;
      }
      if (entries.length > 0) continue;
      try {
        await this.bounded("rmdir", () => this.client.rmdir(absolute));
        // Gone now, so a later write on this connection has to make it again.
        this.shared.directories.delete(absolute);
        pruned += 1;
      } catch (err) {
        if (err instanceof AbandonedError) throw err;
        // Busy, gone, or not ours to remove. Either way, not worth failing over.
      }
    }
    return pruned;
  }
}
