/**
 * The SFTP side of publishing.
 *
 * Two things here are not negotiable. The host key is verified against a
 * fingerprint configured up front, because a stateless container cannot trust
 * on first use — it would re-trust a new key after every restart. And every
 * write goes to a temporary name and is renamed over its target, so a reader
 * never sees a half-written page.
 *
 * Connections are opened per publish and closed again. The bridge serves one
 * user at a low request rate, so a pool would add reconnect handling for no
 * measurable win.
 */
import { createHash, randomBytes } from "node:crypto";
import Client from "ssh2-sftp-client";
import { joinRemote } from "./path.mjs";

export class SftpError extends Error {}

/** ssh2 reports a missing file as SFTP status 2, under several names. */
function isMissing(err) {
  const code = err?.code;
  return code === 2 || code === "ENOENT" || /no such file/i.test(err?.message ?? "");
}

/** OpenSSH prints `SHA256:` and drops the padding; accept it either way. */
export function fingerprintOf(key) {
  return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
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

  try {
    await client.connect({
      host: target.host,
      port: target.port,
      username: target.user,
      ...(target.key ? { privateKey: target.key, passphrase: target.keyPassphrase } : {}),
      ...(target.password ? { password: target.password } : {}),
      readyTimeout: target.timeoutMs,
      hostVerifier: (key) => {
        presented = fingerprintOf(key);
        return fingerprintsMatch(presented, target.fingerprint);
      }
    });
  } catch (err) {
    if (presented && !fingerprintsMatch(presented, target.fingerprint)) {
      throw new SftpError(
        `Host key mismatch for ${target.host}. Configured ${target.fingerprint}, ` +
          `server presented ${presented}. Refusing to connect.`
      );
    }
    throw new SftpError(`Cannot reach ${target.host}: ${err.message}`);
  }

  return new Remote(client, target);
}

class Remote {
  constructor(client, target) {
    this.client = client;
    this.target = target;
  }

  async end() {
    try {
      await this.client.end();
    } catch {
      // A connection that cannot be closed cleanly is already gone.
    }
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
    const kind = await this.client.exists(path);
    if (kind === "l") {
      throw new SftpError(`Refusing to write through a symlink: ${path}`);
    }
    if (kind === "d") {
      throw new SftpError(`A directory is in the way: ${path}`);
    }

    await this.client.mkdir(parentOf(path), true).catch(() => {});

    const temporary = `${path}.schreibstube-${randomBytes(6).toString("hex")}`;
    await this.client.put(Buffer.from(content), temporary);
    try {
      await this.rename(temporary, path);
    } catch (err) {
      await this.client.delete(temporary, true).catch(() => {});
      throw err;
    }
  }

  /**
   * Rename over an existing file.
   *
   * Plain SFTP rename fails when the target exists, so the POSIX extension is
   * tried first: it replaces in one step, which is what makes the write atomic.
   * Servers without it get the two-step fallback and a window of milliseconds.
   */
  async rename(from, to) {
    try {
      await this.client.posixRename(from, to);
    } catch {
      await this.client.delete(to, true).catch(() => {});
      await this.client.rename(from, to);
    }
  }

  /** False, "d", "-" or "l", as the client reports it. */
  async exists(path) {
    return this.client.exists(path);
  }

  async readFile(path) {
    const buffer = await this.client.get(path);
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

  async listNames(path) {
    try {
      return (await this.client.list(path)).map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  async remove(relative) {
    await this.client.delete(this.absolute(relative), true);
  }

  async removeAbsolute(path) {
    await this.client.delete(path, true);
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
      const entries = await this.listNames(absolute);
      if (entries.length > 0) continue;
      try {
        await this.client.rmdir(absolute);
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
