import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyDocument } from "./document.mjs";
import { createPlanStore, PlanStoreError } from "./store.mjs";

/**
 * The store against a real directory, because every claim it makes is a claim
 * about a file: that a revision went up, that a temporary file did not stay
 * behind, that two writers at the same revision did not both win.
 */

let directory;
let path;
let store;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "schreibstube-plan-"));
  path = join(directory, "nested", "plan.json");
  store = createPlanStore(path);
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function planWith(acked) {
  return { ...emptyDocument(), acked };
}

describe("reading", () => {
  it("reads a missing file as the empty document at revision zero", async () => {
    expect(await store.read()).toEqual({ rev: 0, document: emptyDocument() });
  });

  it("hands each reader its own copy of the empty document", async () => {
    const first = await store.read();
    first.document.acked = 99;
    expect((await store.read()).document.acked).toBe(0);
  });

  it("reports a file that is not JSON rather than replacing it", async () => {
    await writeFile(path.replace("/nested/", "/"), "{");
    const flat = createPlanStore(path.replace("/nested/", "/"));
    await expect(flat.read()).rejects.toThrow(PlanStoreError);
    await expect(flat.read()).rejects.toThrow(/not valid JSON/);
  });

  it("reports a file that holds the wrong kind of thing", async () => {
    const other = join(directory, "array.json");
    await writeFile(other, "[]");
    await expect(createPlanStore(other).read()).rejects.toThrow(/does not hold an object/);
  });

  it("reports a file with no usable revision", async () => {
    const other = join(directory, "norev.json");
    await writeFile(other, JSON.stringify({ document: emptyDocument() }));
    await expect(createPlanStore(other).read()).rejects.toThrow(/no usable revision/);

    await writeFile(other, JSON.stringify({ rev: -1, document: emptyDocument() }));
    await expect(createPlanStore(other).read()).rejects.toThrow(/no usable revision/);
  });

  it("reports a stored document that no longer validates, naming the field", async () => {
    const other = join(directory, "kaputt.json");
    await writeFile(other, JSON.stringify({ rev: 3, document: { ...emptyDocument(), acked: -1 } }));
    await expect(createPlanStore(other).read()).rejects.toThrow(
      /stored plan is unusable: document.acked/
    );
  });

  it("reports a path it cannot read at all", async () => {
    // A directory where a file should be: readable as an entry, not as JSON.
    await expect(createPlanStore(directory).read()).rejects.toThrow(/cannot be read/);
  });
});

describe("reading what it already knows", () => {
  it("answers from what it last wrote while the file is unchanged", async () => {
    await store.write(planWith(3), 0);
    expect((await store.read()).document.acked).toBe(3);
  });

  it("still sees the file when someone edits it on disk", async () => {
    await store.write(planWith(3), 0);
    await store.read();

    const edited = JSON.stringify({ rev: 7, document: planWith(9) });
    await new Promise((done) => setTimeout(done, 20));
    await writeFile(path, edited);

    expect(await store.read()).toEqual({ rev: 7, document: planWith(9) });
  });

  it("reads a file removed on disk as the empty plan again", async () => {
    await store.write(planWith(3), 0);
    await rm(path);
    expect(await store.read()).toEqual({ rev: 0, document: emptyDocument() });
  });
});

describe("writing", () => {
  it("assigns the revision itself, one higher each time", async () => {
    expect(await store.write(planWith(1), 0)).toEqual({ ok: true, rev: 1 });
    expect(await store.write(planWith(2), 1)).toEqual({ ok: true, rev: 2 });
    expect(await store.write(planWith(3), 2)).toEqual({ ok: true, rev: 3 });
  });

  it("creates the directory the store was pointed at", async () => {
    await store.write(planWith(1), 0);
    expect(await readdir(join(directory, "nested"))).toContain("plan.json");
  });

  it("reads back exactly what was written", async () => {
    await store.write(planWith(7), 0);
    expect(await store.read()).toEqual({ rev: 1, document: planWith(7) });
  });

  it("refuses a write against a revision that has moved on, and says which", async () => {
    await store.write(planWith(1), 0);
    const refused = await store.write(planWith(2), 0);
    expect(refused.ok).toBe(false);
    expect(refused.rev).toBe(1);
    expect(refused.document).toEqual(planWith(1));
  });

  it("leaves the stored document untouched when it refuses", async () => {
    await store.write(planWith(1), 0);
    await store.write(planWith(99), 0);
    expect((await store.read()).document.acked).toBe(1);
  });

  it("lets exactly one of two writers at the same revision win", async () => {
    await store.write(planWith(1), 0);
    const [first, second] = await Promise.all([
      store.write(planWith(2), 1),
      store.write(planWith(3), 1)
    ]);
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect((await store.read()).rev).toBe(2);
  });

  it("keeps a run of concurrent writes in step rather than losing one", async () => {
    let rev = 0;
    for (let round = 0; round < 5; round += 1) {
      const result = await store.write(planWith(round), rev);
      expect(result.ok).toBe(true);
      rev = result.rev;
    }
    expect(await store.read()).toEqual({ rev: 5, document: planWith(4) });
  });

  it("leaves no temporary file behind", async () => {
    await store.write(planWith(1), 0);
    await store.write(planWith(2), 1);
    expect((await readdir(join(directory, "nested"))).filter((n) => n.endsWith(".tmp"))).toEqual(
      []
    );
  });

  it("stores the document and the revision side by side, with no history", async () => {
    await store.write(planWith(1), 0);
    await store.write(planWith(2), 1);
    const stored = JSON.parse(await readFile(path, "utf8"));
    expect(Object.keys(stored).sort()).toEqual(["document", "rev"]);
    expect(stored).toEqual({ rev: 2, document: planWith(2) });
  });

  it("reports a path it cannot write to", async () => {
    const blocked = createPlanStore(join(directory, "plan.json", "tiefer.json"));
    await writeFile(join(directory, "plan.json"), "{}");
    await expect(blocked.write(planWith(1), 0)).rejects.toThrow(PlanStoreError);
  });

  it("keeps serving after a failed write rather than wedging the queue", async () => {
    const other = join(directory, "kaputt.json");
    await writeFile(other, "{");
    const broken = createPlanStore(other);
    await expect(broken.read()).rejects.toThrow(PlanStoreError);
    await expect(broken.read()).rejects.toThrow(PlanStoreError);
  });

  it("remembers the path it was given", () => {
    expect(store.path).toBe(path);
  });
});
