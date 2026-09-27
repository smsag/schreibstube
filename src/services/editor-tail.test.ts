// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { EDITOR_TAIL_VAR, editorTail, keepEditorTailBelow } from "./workspace-internals";

/**
 * Obsidian pads the end of the editor's content inline, half the editor's
 * height, and a block drawn after that content sat below the padding: half a
 * screen of nothing between the note and Recommended. The padding's size is
 * handed to the block so the stylesheet can move it below instead.
 */
const settle = () => new Promise((r) => setTimeout(r, 0));

function editor(padding: string) {
  const sizer = document.createElement("div");
  sizer.className = "cm-sizer";
  const content = sizer.appendChild(document.createElement("div"));
  content.className = "cm-content";
  content.style.paddingBottom = padding;
  const block = sizer.appendChild(document.createElement("div"));
  return { sizer, content, block };
}

describe("editorTail", () => {
  it("reads Obsidian's inline padding in px", () => {
    expect(editorTail("380px")).toBe(380);
    expect(editorTail(" 100px ")).toBe(100);
    expect(editorTail("12.5px")).toBe(12.5);
  });

  it("reads anything else as no tail, never as a guess", () => {
    for (const value of ["", "0px", "-20px", "50%", "2em", "calc(1px + 2px)", "NaNpx", "px"]) {
      expect(editorTail(value), value).toBe(0);
    }
  });
});

describe("keepEditorTailBelow", () => {
  it("hands the padding to the block and follows it as Obsidian changes it", async () => {
    const { sizer, content, block } = editor("380px");
    const stop = keepEditorTailBelow(sizer, block);
    expect(block.style.getPropertyValue(EDITOR_TAIL_VAR)).toBe("380px");

    // The find bar opened: Obsidian shrinks the padding to 100px.
    content.style.paddingBottom = "100px";
    await settle();
    expect(block.style.getPropertyValue(EDITOR_TAIL_VAR)).toBe("100px");

    stop();
    expect(block.style.getPropertyValue(EDITOR_TAIL_VAR)).toBe("");
    content.style.paddingBottom = "200px";
    await settle();
    expect(block.style.getPropertyValue(EDITOR_TAIL_VAR)).toBe("");
  });

  it("does nothing where there is no editor content to read", () => {
    const sizer = document.createElement("div");
    const block = sizer.appendChild(document.createElement("div"));
    const stop = keepEditorTailBelow(sizer, block);
    expect(block.style.getPropertyValue(EDITOR_TAIL_VAR)).toBe("");
    stop();
  });
});

describe("placeAfterNote", () => {
  it("puts the block straight after the editor's content, ahead of Obsidian's backlinks", async () => {
    const { placeAfterNote } = await import("./workspace-internals");
    const sizer = document.createElement("div");
    const content = sizer.appendChild(document.createElement("div"));
    content.className = "cm-contentContainer";
    const backlinks = sizer.appendChild(document.createElement("div"));
    backlinks.className = "embedded-backlinks";
    const block = document.createElement("div");

    placeAfterNote(sizer, block);
    expect(Array.from(sizer.children)).toEqual([content, block, backlinks]);
    placeAfterNote(sizer, block); // again: nothing moves
    expect(Array.from(sizer.children)).toEqual([content, block, backlinks]);
  });

  it("appends it where there is no editor content, as in Reading view", async () => {
    const { placeAfterNote } = await import("./workspace-internals");
    const footer = document.createElement("div");
    footer.appendChild(document.createElement("p"));
    const block = document.createElement("div");
    placeAfterNote(footer, block);
    expect(footer.lastElementChild).toBe(block);
  });
});
