import { describe, expect, it } from "vitest";
import { TimeoutError } from "../timeout.mjs";
import {
  connect,
  fingerprintOf,
  fingerprintsMatch,
  HostKeyMismatchError,
  keyTypeOf,
  Remote,
  SftpError
} from "./sftp.mjs";

/** Host key checks that need no server: the key blob is only bytes. */

const blob = (name, rest = Buffer.from([1, 2, 3])) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(name.length, 0);
  return Buffer.concat([length, Buffer.from(name, "latin1"), rest]);
};

describe("keyTypeOf", () => {
  for (const name of ["ssh-ed25519", "ecdsa-sha2-nistp256", "ssh-rsa"]) {
    it(`reads ${name} from the blob`, () => {
      expect(keyTypeOf(blob(name))).toBe(name);
    });
  }

  it("says unknown for a blob too short to name anything", () => {
    expect(keyTypeOf(Buffer.from([0, 0]))).toBe("unknown");
    expect(keyTypeOf(undefined)).toBe("unknown");
  });

  it("says unknown when the declared length runs past the blob", () => {
    const truncated = Buffer.from([0, 0, 0, 20, 0x73, 0x73, 0x68]);
    expect(keyTypeOf(truncated)).toBe("unknown");
  });

  it("does not quote bytes that are not an algorithm name", () => {
    expect(keyTypeOf(blob("ssh\nrsa"))).toBe("unknown");
  });
});

describe("fingerprintsMatch", () => {
  it("accepts OpenSSH's form, without padding, against a padded one", () => {
    const key = blob("ssh-ed25519");
    const printed = fingerprintOf(key);
    expect(fingerprintsMatch(printed, `${printed}=`)).toBe(true);
    expect(fingerprintsMatch(printed, printed.replace(/^SHA256:/, ""))).toBe(true);
  });

  it("refuses the fingerprint of another key", () => {
    expect(
      fingerprintsMatch(fingerprintOf(blob("ssh-ed25519")), fingerprintOf(blob("ssh-rsa")))
    ).toBe(false);
  });
});

/**
 * The connection's operations against a fake client: which errors earn the
 * rename fallback, which are raised, and that none of them can wait forever.
 */
function fakeClient(overrides = {}) {
  const calls = [];
  // Directories made on this fake host, so the walk above a write finds them.
  const made = new Set();
  const behaviours = {
    exists: async (path) => (made.has(path) ? "d" : false),
    put: undefined,
    mkdir: async (path) => {
      made.add(path);
    },
    posixRename: undefined,
    rename: undefined,
    delete: undefined,
    list: [],
    get: Buffer.from("{}"),
    rmdir: undefined,
    ...overrides
  };
  const client = { calls };
  for (const [name, result] of Object.entries(behaviours)) {
    client[name] = (...args) => {
      calls.push([name, ...args]);
      return typeof result === "function" ? result(...args) : Promise.resolve(result);
    };
  }
  return client;
}

const target = { root: "/site", stateRoot: "/state", timeoutMs: 20 };
const never = () => new Promise(() => {});

describe("Remote, deadlines", () => {
  it("gives up on an operation the server never answers, naming it", async () => {
    const remote = new Remote(fakeClient({ list: never }), target);
    await expect(remote.listNames("/site")).rejects.toThrow("SFTP list timed out");
    const stuck = new Remote(fakeClient({ put: never }), target);
    await expect(stuck.writeFile("a/index.html", "x")).rejects.toThrow("SFTP put timed out");
  });
});

describe("Remote, writing", () => {
  it("removes what a put that failed part way left under the temporary name", async () => {
    const client = fakeClient({ put: () => Promise.reject(new Error("Connection lost")) });
    const remote = new Remote(client, target);
    await expect(remote.writeFile("a/index.html", "x")).rejects.toThrow("Connection lost");
    const [, temporary] = client.calls.find(([name]) => name === "put").slice(1);
    expect(temporary).toMatch(/^\/site\/a\/index\.html\.schreibstube-[0-9a-f]{12}$/);
    expect(client.calls).toContainEqual(["delete", temporary, true]);
  });
});

describe("Remote, reading", () => {
  it("asks for one byte past its bound and refuses a file that goes on", async () => {
    const client = fakeClient({ get: Buffer.alloc(11) });
    const remote = new Remote(client, target);
    await expect(remote.readFile("/state/manifest.json", { maxBytes: 10 })).rejects.toMatchObject({
      clientMessage: "A file on the host is larger than the bridge reads."
    });
    expect(client.calls[0]).toEqual([
      "get",
      "/state/manifest.json",
      undefined,
      { readStreamOptions: { start: 0, end: 10 } }
    ]);
  });

  it("hands over a file that ends at its bound", async () => {
    const remote = new Remote(fakeClient({ get: Buffer.alloc(10, 1) }), target);
    expect(await remote.readFile("/state/x", { maxBytes: 10 })).toEqual(Buffer.alloc(10, 1));
  });
});

describe("connect", () => {
  /** The library's client, as far as connecting goes: the SSH client inside it records a close. */
  function connectingClient(connecting) {
    const ssh = { destroyed: 0, destroy: () => (ssh.destroyed += 1) };
    return { client: ssh, connect: connecting };
  }
  const host = { host: "sftp.example.com", port: 22, user: "web", fingerprint: "x" };

  it("closes the SSH connection when the SFTP channel is refused after the login", async () => {
    const client = connectingClient(() => Promise.reject(new Error("Unable to start subsystem")));
    await expect(connect({ ...host, timeoutMs: 1_000 }, { client })).rejects.toMatchObject({
      clientMessage: "Cannot reach the SFTP host."
    });
    expect(client.client.destroyed).toBe(1);
  });

  it("closes a connection still opening when its deadline runs out", async () => {
    const client = connectingClient(never);
    await expect(connect({ ...host, timeoutMs: 20 }, { client })).rejects.toBeInstanceOf(
      TimeoutError
    );
    expect(client.client.destroyed).toBe(1);
  });
});

describe("Remote, listing", () => {
  it("reads an absent directory as empty and raises anything else", async () => {
    const missing = Object.assign(new Error("No such file"), { code: 2 });
    const gone = new Remote(fakeClient({ list: () => Promise.reject(missing) }), target);
    expect(await gone.listNames("/site/x")).toEqual([]);
    const denied = Object.assign(new Error("Permission denied /site"), { code: 3 });
    const forbidden = new Remote(fakeClient({ list: () => Promise.reject(denied) }), target);
    await expect(forbidden.listNames("/site")).rejects.toBe(denied);
  });
});

describe("Remote, renaming over a file", () => {
  const unsupported = [
    new Error("Server does not support this extended request"),
    Object.assign(new Error("Operation unsupported From: a To: b"), { code: 8 })
  ];

  for (const err of unsupported) {
    it(`falls back to delete and rename when the server says "${err.message.slice(0, 20)}…"`, async () => {
      const client = fakeClient({ posixRename: () => Promise.reject(err) });
      const remote = new Remote(client, target);
      await remote.rename("/site/a.tmp", "/site/a.html");
      expect(client.calls.map(([name]) => name)).toEqual(["posixRename", "delete", "rename"]);
    });
  }

  it("remembers per connection that the server lacks the extension", async () => {
    const client = fakeClient({ posixRename: () => Promise.reject(unsupported[0]) });
    const remote = new Remote(client, target);
    await remote.rename("/site/a.tmp", "/site/a.html");
    await remote.rename("/site/b.tmp", "/site/b.html");
    expect(client.calls.filter(([name]) => name === "posixRename")).toHaveLength(1);
  });

  it("raises any other refusal without deleting the target first", async () => {
    const denied = Object.assign(new Error("Permission denied From: a To: b"), { code: 3 });
    const client = fakeClient({ posixRename: () => Promise.reject(denied) });
    const remote = new Remote(client, target);
    await expect(remote.rename("/site/a.tmp", "/site/a.html")).rejects.toBe(denied);
    expect(client.calls.map(([name]) => name)).toEqual(["posixRename"]);
    expect(remote.posixRename).toBeNull();
  });

  it("uses the extension alone once it worked", async () => {
    const client = fakeClient();
    const remote = new Remote(client, target);
    await remote.rename("/site/a.tmp", "/site/a.html");
    expect(client.calls.map(([name]) => name)).toEqual(["posixRename"]);
    expect(remote.posixRename).toBe(true);
  });
});

describe("what the client is told", () => {
  it("quotes a host key mismatch verbatim and summarises everything else", () => {
    const mismatch = new HostKeyMismatchError(
      "Host key mismatch for h. Configured a, presented b."
    );
    expect(mismatch.clientMessage).toBe(mismatch.message);
    expect(mismatch).toBeInstanceOf(SftpError);
    const symlink = new SftpError("Refusing to write through a symlink: /var/www/x", {
      client: "Refusing to write through a symlink."
    });
    expect(symlink.clientMessage).not.toContain("/var/www");
    expect(new SftpError("delete: Permission denied /var/www/x").clientMessage).toBe(
      "SFTP failed."
    );
  });
});
