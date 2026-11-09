import { describe, expect, it } from "vitest";
import type { PublishAccount } from "../types";
import {
  accountProblems,
  bridgeEnvironment,
  isKept,
  STARTER_TOKEN_BYTES,
  starterEnvironment,
  tokenFromBytes
} from "./publish-accounts";

function account(changes: Partial<PublishAccount>): PublishAccount {
  return {
    id: changes.target ?? "id",
    name: "",
    folder: "",
    target: "",
    writeBack: true,
    aiDescription: false,
    headerTags: [],
    ...changes
  };
}

const everyFolder = () => true;

describe("accountProblems", () => {
  it("finds nothing wrong with a complete account of its own", () => {
    const blog = account({ name: "Blog", folder: "Blog", target: "blog" });
    expect(accountProblems(blog, [blog], everyFolder)).toEqual([]);
  });

  it("names a missing folder and a missing target, which the next load drops", () => {
    const empty = account({});
    const problems = accountProblems(empty, [empty], everyFolder);
    expect(problems).toEqual([{ kind: "noFolder" }, { kind: "noTarget" }]);
    expect(isKept(problems)).toBe(false);
  });

  it("asks the vault only about a folder that is filled in", () => {
    const asked: string[] = [];
    const blog = account({ folder: "/Blog/", target: "blog" });
    const problems = accountProblems(blog, [blog], (folder) => (asked.push(folder), false));
    expect(asked).toEqual(["Blog"]);
    expect(problems).toEqual([{ kind: "folderMissing" }]);
    expect(isKept(problems)).toBe(true);
  });

  it("refuses a target name the bridge would not start with", () => {
    for (const target of ["My Blog", "Blog", "-blog", "a,b"]) {
      const site = account({ folder: "Blog", target });
      expect(accountProblems(site, [site], everyFolder)).toEqual([{ kind: "badTarget" }]);
    }
  });

  it("names the other account sharing a target", () => {
    const blog = account({ id: "1", name: "Blog", folder: "Blog", target: "site" });
    const notes = account({ id: "2", name: "Notes", folder: "Notes", target: "site" });
    expect(accountProblems(blog, [blog, notes], everyFolder)).toEqual([
      { kind: "sameTarget", other: "Notes" }
    ]);
  });

  it("tells a shared folder from a nested one, in both directions", () => {
    const outer = account({ id: "1", name: "All", folder: "Sites", target: "all" });
    const inner = account({ id: "2", name: "Blog", folder: "Sites/Blog", target: "blog" });
    const twin = account({ id: "3", name: "Twin", folder: "Sites", target: "twin" });
    const sibling = account({ id: "4", name: "Side", folder: "Sites-old", target: "side" });
    const all = [outer, inner, twin, sibling];

    expect(accountProblems(inner, all, everyFolder)).toEqual([
      { kind: "insideFolder", other: "All" },
      { kind: "insideFolder", other: "Twin" }
    ]);
    expect(accountProblems(outer, all, everyFolder)).toEqual([
      { kind: "holdsFolder", other: "Blog" },
      { kind: "sameFolder", other: "Twin" }
    ]);
    expect(accountProblems(sibling, all, everyFolder)).toEqual([]);
  });

  it("calls an unnamed account by its folder", () => {
    const one = account({ id: "1", folder: "Blog", target: "site" });
    const two = account({ id: "2", folder: "Notes", target: "site" });
    expect(accountProblems(two, [one, two], everyFolder)).toEqual([
      { kind: "sameTarget", other: "Blog" }
    ]);
  });
});

describe("bridgeEnvironment", () => {
  it("lists every target once, in one PUBLISH_TARGETS line", () => {
    const block = bridgeEnvironment(
      [
        account({ name: "Blog", target: "blog" }),
        account({ name: "Team", target: "team" }),
        account({ name: "Again", target: "blog" })
      ],
      "Website"
    );
    expect(block.match(/PUBLISH_TARGETS=/g)).toHaveLength(1);
    expect(block).toContain("PUBLISH_TARGETS=blog,team");
    expect(block).toContain("PUBLISH_BLOG_SITE_TITLE=Blog");
    expect(block).toContain("PUBLISH_TEAM_SITE_TITLE=Team");
    expect(block).not.toContain("Again");
  });

  it("keeps a line break in a name from starting a variable of its own", () => {
    const block = bridgeEnvironment(
      [account({ name: "Blog\nPUBLISH_TOKEN=x", target: "blog" })],
      "Website"
    );
    expect(block).not.toMatch(/^PUBLISH_TOKEN=/m);
  });

  it("writes a starting point when nothing is configured", () => {
    const block = bridgeEnvironment([], "Website");
    expect(block).toContain("PUBLISH_TARGETS=blog");
    expect(block).toContain("PUBLISH_BLOG_SITE_TITLE=Website");
  });
});

describe("starterEnvironment", () => {
  it("adds the port, the proxy and the token in front of every site", () => {
    const block = starterEnvironment(
      [account({ name: "Blog", target: "blog" }), account({ name: "Team", target: "team" })],
      "Website",
      "abc123"
    );
    expect(block.startsWith("PORT=8080\nTRUST_PROXY=true\nPUBLISH_TOKEN=abc123\n\n")).toBe(true);
    expect(block).toContain("PUBLISH_TARGETS=blog,team");
    expect(block.match(/PUBLISH_TOKEN=/g)).toHaveLength(1);
  });

  it("keeps a line break in the token from starting a variable", () => {
    expect(starterEnvironment([], "Website", "a\nPORT=1")).not.toMatch(/^PORT=1$/m);
  });
});

describe("tokenFromBytes", () => {
  it("writes every byte as two hex digits", () => {
    expect(tokenFromBytes(new Uint8Array([0, 15, 255]))).toBe("000fff");
  });

  it("makes a token the bridge accepts from the starter's bytes", () => {
    const bytes = new Uint8Array(STARTER_TOKEN_BYTES).map((_, index) => index * 7);
    const token = tokenFromBytes(bytes);
    expect(token).toHaveLength(64);
    expect(new Set(token).size).toBeGreaterThanOrEqual(10);
  });
});
