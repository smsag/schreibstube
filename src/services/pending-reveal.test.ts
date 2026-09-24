import { describe, expect, it } from "vitest";
import { PendingReveal } from "./pending-reveal";

describe("PendingReveal", () => {
  it("makes the jump on the first draw that shows the row", () => {
    const reveal = new PendingReveal();
    reveal.request("Notes/Brief.md", true);

    expect(reveal.settle("on-screen")).toEqual({ path: "Notes/Brief.md", quietly: true });
    expect(reveal.settle("on-screen")).toBeNull();
  });

  it("waits while the pane has no layout, as in a shut sidebar", () => {
    const reveal = new PendingReveal();
    reveal.request("Notes/Brief.md", true);

    expect(reveal.settle("without-layout")).toBeNull();
    expect(reveal.path).toBe("Notes/Brief.md");
    expect(reveal.settle("on-screen")?.path).toBe("Notes/Brief.md");
  });

  it("drops the waiting jump when the person folds something", () => {
    // The bug: a note opened on a phone left its jump waiting, and folding a
    // bookmark folder was the next draw — the pane leapt to the open note.
    const reveal = new PendingReveal();
    reveal.request("Notes/Brief.md", true);
    reveal.settle("without-layout");

    reveal.browsed();

    expect(reveal.path).toBeNull();
    expect(reveal.settle("on-screen")).toBeNull();
  });

  it("ends a jump whose row is not drawn at all", () => {
    const reveal = new PendingReveal();
    reveal.request("Filtered/Out.md", false);

    expect(reveal.settle("missing")).toBeNull();
    expect(reveal.path).toBeNull();
  });

  it("takes the latest request over one still waiting", () => {
    const reveal = new PendingReveal();
    reveal.request("First.md", true);
    reveal.request("Folder", false);

    expect(reveal.settle("on-screen")).toEqual({ path: "Folder", quietly: false });
  });

  it("has nothing to do when nothing was asked", () => {
    expect(new PendingReveal().settle("on-screen")).toBeNull();
  });
});
