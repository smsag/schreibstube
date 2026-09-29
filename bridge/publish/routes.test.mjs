import { describe, expect, it } from "vitest";
import { createConnectionPool } from "./connection-pool.mjs";
import {
  availableAssets,
  clientMessage,
  exclusive,
  isAssetContent,
  targetOf,
  withRemote
} from "./routes.mjs";
import { HostKeyMismatchError, SftpError } from "./sftp.mjs";
import { TimeoutError } from "../timeout.mjs";

/**
 * The pieces of the publish routes that decide something on their own: the
 * lock and the deadline around a publish, what the client is told, which
 * uploads the commit may count on.
 */

const never = () => new Promise(() => {});

function fakePool() {
  const remotes = [];
  const pool = createConnectionPool({
    connect: async () => {
      const remote = {
        ended: false,
        onClose() {},
        async end() {
          remote.ended = true;
        }
      };
      remotes.push(remote);
      return remote;
    },
    setTimer: () => 0,
    clearTimer: () => {}
  });
  return { pool, remotes };
}

const target = { name: "blog" };

describe("exclusive", () => {
  it("refuses a second publish while one runs, and frees the target when the first ends", async () => {
    const busy = new Set();
    let finish;
    const first = exclusive(busy, "blog", () => new Promise((resolve) => (finish = resolve)));
    await expect(exclusive(busy, "blog", async () => {})).rejects.toMatchObject({
      status: 409,
      code: "publish_in_progress"
    });
    finish("done");
    await expect(first).resolves.toBe("done");
    await expect(exclusive(busy, "blog", async () => "again")).resolves.toBe("again");
  });

  it("holds the target for as long as the work runs: only its connection can end it", async () => {
    const busy = new Set();
    const { pool, remotes } = fakePool();
    const hung = exclusive(busy, "blog", () => withRemote(pool, target, 10, never));
    await expect(hung).rejects.toBeInstanceOf(TimeoutError);
    expect(remotes[0].ended).toBe(true);
    expect(busy.has("blog")).toBe(false);
  });
});

describe("withRemote", () => {
  it("retires the connection when the work outlives its budget, so the hung request fails", async () => {
    const { pool, remotes } = fakePool();
    await expect(withRemote(pool, target, 10, never)).rejects.toBeInstanceOf(TimeoutError);
    expect(remotes[0].ended).toBe(true);
    expect(pool.size).toBe(0);
  });

  it("answers a login that failed as unreachable, with the short wording", async () => {
    const pool = createConnectionPool({
      connect: async () => {
        throw new SftpError("Cannot reach h: ECONNREFUSED", {
          client: "Cannot reach the SFTP host."
        });
      }
    });
    await expect(withRemote(pool, target, 100, async () => {})).rejects.toMatchObject({
      status: 502,
      code: "sftp_unreachable",
      message: "Cannot reach the SFTP host.",
      detail: expect.stringContaining("ECONNREFUSED")
    });
  });

  it("passes the route's own refusals through and keeps the connection", async () => {
    const { pool, remotes } = fakePool();
    const refusal = Object.assign(new Error("no"), { status: 409, code: "x" });
    await expect(
      withRemote(pool, target, 100, async () => {
        throw refusal;
      })
    ).rejects.toBe(refusal);
    expect(remotes[0].ended).toBe(false);
  });

  it("summarises a library error and keeps its detail for the log", async () => {
    const { pool } = fakePool();
    await expect(
      withRemote(pool, target, 100, async () => {
        throw new Error("delete: Permission denied /var/www/blog/x.html");
      })
    ).rejects.toMatchObject({
      status: 502,
      code: "sftp_error",
      message: "SFTP failed.",
      detail: expect.stringContaining("/var/www/blog")
    });
  });
});

describe("clientMessage", () => {
  it("quotes only a host key mismatch verbatim", () => {
    expect(clientMessage(new HostKeyMismatchError("Host key mismatch for h."))).toBe(
      "Host key mismatch for h."
    );
    expect(clientMessage(new SftpError("A directory is in the way: /var/www/x"))).toBe(
      "SFTP failed."
    );
    expect(clientMessage(new Error("Permission denied /var/www/x"))).toBe("SFTP failed.");
    expect(clientMessage(new TimeoutError("SFTP list", 20_000))).toBe(
      "SFTP list timed out after 20s"
    );
  });
});

describe("targetOf", () => {
  const publish = { targets: { blog: { name: "blog" } } };

  it("finds a configured target and nothing that is merely a property of every object", () => {
    expect(targetOf(publish, " blog ")).toBe(publish.targets.blog);
    for (const name of ["constructor", "__proto__", "hasOwnProperty", "", undefined]) {
      expect(() => targetOf(publish, name)).toThrow(expect.objectContaining({ status: 404 }));
    }
  });
});

describe("availableAssets", () => {
  const hash = (value) => `${value}`.padEnd(64, "0");
  const assets = [
    { sourcePath: "Blog/a.png", sha256: hash("a"), name: "a.png", bytes: 1 },
    { sourcePath: "Blog/b.png", sha256: hash("b"), name: "b.png", bytes: 2 }
  ];
  const pathOf = (value, stem) => `assets/${hash(value).slice(0, 12)}-${stem}.png`;

  it("counts an asset as there when the manifest has it or an upload wrote it, and names the rest", () => {
    const manifest = { files: { [pathOf("a", "a")]: { sha256: hash("a"), bytes: 1 } } };
    const written = new Map([[pathOf("b", "b"), { sha256: hash("b"), bytes: 2 }]]);
    expect(availableAssets({ assets }, manifest, written)).toEqual({
      uploaded: new Map([
        [pathOf("a", "a"), { sha256: hash("a"), bytes: 1 }],
        [pathOf("b", "b"), { sha256: hash("b"), bytes: 2 }]
      ]),
      missing: []
    });
    expect(availableAssets({ assets }, manifest).missing).toEqual(["Blog/b.png"]);
    expect(availableAssets({ assets }, { files: {} }).missing).toEqual([
      "Blog/a.png",
      "Blog/b.png"
    ]);
  });
});

describe("isAssetContent", () => {
  it("holds an SVG to the tab icon's rule and a raster file to its signature", () => {
    expect(isAssetContent(Buffer.from("<svg><rect/></svg>"), "svg")).toBe(true);
    expect(isAssetContent(Buffer.from('<svg onload="x"/>'), "svg")).toBe(false);
    expect(isAssetContent(Buffer.from("<html><svg/></html>"), "svg")).toBe(false);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
    expect(isAssetContent(png, "png")).toBe(true);
    expect(isAssetContent(png, "jpg")).toBe(false);
    expect(isAssetContent(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "jpeg")).toBe(true);
    expect(isAssetContent(Buffer.from("x"), "png")).toBe(false);
  });

  it("takes a format it has no signature for on its extension alone", () => {
    expect(isAssetContent(Buffer.from("anything"), "webp")).toBe(true);
    expect(isAssetContent(Buffer.from("anything"), "mp4")).toBe(true);
  });
});
