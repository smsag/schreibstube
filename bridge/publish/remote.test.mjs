import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startSftpServer } from "./sftp-fixture.mjs";
import { AbandonedError, connect } from "./sftp.mjs";
import { createConnectionPool } from "./connection-pool.mjs";
import { withRemote } from "./routes.mjs";
import { TimeoutError } from "../timeout.mjs";

/**
 * The connection against a real SFTP server whose disk holds links: what the
 * bridge refuses to follow, and what a publish that ran out of time can still
 * do afterwards — nothing.
 */

let sftp;
let target;
const disk = (...parts) => join(sftp.root, ...parts);
const present = async (...parts) =>
  readdir(disk(...parts.slice(0, -1))).then(
    (names) => names.includes(parts.at(-1)),
    () => false
  );

beforeAll(async () => {
  sftp = await startSftpServer();
  target = {
    name: "blog",
    host: "127.0.0.1",
    port: sftp.port,
    user: sftp.user,
    password: sftp.password,
    fingerprint: sftp.fingerprint,
    root: "/site",
    stateRoot: "/state",
    timeoutMs: 5_000
  };
}, 20_000);

afterAll(async () => {
  await sftp?.stop();
});

beforeEach(async () => {
  for (const name of ["site", "state", "elsewhere"]) {
    await rm(disk(name), { recursive: true, force: true });
    await mkdir(disk(name), { recursive: true });
  }
});

async function withConnection(work) {
  const remote = await connect(target);
  try {
    return await work(remote);
  } finally {
    await remote.end();
  }
}

describe("a linked directory below the root", () => {
  it("is not written through, at any depth", async () => {
    await symlink(disk("elsewhere"), disk("site", "assets"));
    await mkdir(disk("site", "a"));
    await symlink(disk("elsewhere"), disk("site", "a", "b"));

    await withConnection(async (remote) => {
      await expect(remote.writeFile("assets/x.png", "x")).rejects.toThrow(/linked directory/);
      await expect(remote.writeFile("a/b/c/index.html", "x")).rejects.toThrow(/linked directory/);
    });
    expect(await readdir(disk("elsewhere"))).toEqual([]);
  });

  it("is not deleted through, and neither is a link where a file was", async () => {
    await writeFile(disk("elsewhere", "victim.html"), "keep");
    await symlink(disk("elsewhere"), disk("site", "assets"));
    await symlink(disk("elsewhere", "victim.html"), disk("site", "page.html"));

    await withConnection(async (remote) => {
      await expect(remote.remove("assets/victim.html")).rejects.toThrow(/linked directory/);
      await expect(remote.remove("page.html")).rejects.toThrow(/symlink/);
    });
    expect(await present("elsewhere", "victim.html")).toBe(true);
  });

  it("is not pruned, nor anything reached through it", async () => {
    await mkdir(disk("elsewhere", "empty"));
    await symlink(disk("elsewhere"), disk("site", "assets"));

    await withConnection(async (remote) => {
      expect(await remote.pruneEmptyDirectories(["assets/empty/x.png"])).toBe(0);
    });
    expect(await present("elsewhere", "empty")).toBe(true);
    expect(await present("site", "assets")).toBe(true);
  });

  it("is not followed into the state directory either", async () => {
    await symlink(disk("elsewhere"), disk("state", "src"));
    await withConnection(async (remote) => {
      await expect(remote.writeAbsolute(remote.stateAbsolute("src/abc.md"), "# x")).rejects.toThrow(
        /linked directory/
      );
    });
    expect(await readdir(disk("elsewhere"))).toEqual([]);
  });

  it("leaves real directories alone, made once and remembered", async () => {
    await withConnection(async (remote) => {
      await remote.writeFile("deep/er/index.html", "a");
      sftp.resetStats();
      await remote.writeFile("deep/er/other.html", "b");
      // The second write into the same directory looks only at its own file.
      expect(sftp.stats.requests.LSTAT ?? 0).toBe(1);
    });
    expect(await present("site", "deep", "er", "other.html")).toBe(true);
  });

  it("refuses a file standing where a directory should be", async () => {
    await writeFile(disk("site", "assets"), "a file");
    await withConnection(async (remote) => {
      await expect(remote.writeFile("assets/x.png", "x")).rejects.toThrow(/in the way/);
    });
  });
});

describe("a publish that ran out of time", () => {
  it("sends nothing more once abandoned, and the next one has the target to itself", async () => {
    const pool = createConnectionPool({ connect: () => connect(target) });
    sftp.stats.slowWrites.set("/site/slow.html", 1_000);
    try {
      const abandoned = withRemote(pool, target, 200, async (remote) => {
        await remote.writeFile("slow.html", "first");
        await remote.writeFile("after.html", "too late");
      });
      await expect(abandoned).rejects.toBeInstanceOf(TimeoutError);

      const next = await withRemote(pool, target, 5_000, async (remote) => {
        await remote.writeFile("second.html", "mine");
        return "done";
      });
      expect(next).toBe("done");

      // Long enough for the held write to have been answered, had anyone listened.
      await new Promise((resolve) => setTimeout(resolve, 1_300));
      const names = await readdir(disk("site"));
      expect(names).toContain("second.html");
      expect(names).not.toContain("after.html");
      expect(names).not.toContain("slow.html");
    } finally {
      sftp.stats.slowWrites.clear();
    }
  });
});

describe("a view of the connection whose request was given up", () => {
  it("refuses every operation without asking the server", async () => {
    await withConnection(async (remote) => {
      const controller = new AbortController();
      const view = remote.withSignal(controller.signal);
      await view.writeFile("before.html", "x");
      controller.abort();
      sftp.resetStats();
      await expect(view.writeFile("after.html", "x")).rejects.toBeInstanceOf(AbandonedError);
      await expect(view.listNames("/site")).rejects.toBeInstanceOf(AbandonedError);
      expect(sftp.requestCount).toBe(0);
      // The connection itself, and other views of it, carry on.
      await remote.writeFile("other.html", "y");
    });
    expect(await readdir(disk("site"))).toEqual(["before.html", "other.html"]);
  });
});
