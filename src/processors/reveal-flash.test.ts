import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { revealFlashEffects, revealFlashField } from "./reveal-flash";

const DOC = "Erste Zeile\nzweite Zeile mit Text\ndritte Zeile\n";

function state() {
  return EditorState.create({ doc: DOC, extensions: [revealFlashField] });
}

/** Every decoration in the field, as class and range. */
function marks(s: EditorState) {
  const out: { cls: string; from: number; to: number }[] = [];
  const set = s.field(revealFlashField).set;
  set.between(0, s.doc.length, (from, to, deco) => {
    const spec = deco.spec as { class?: string; widget?: unknown };
    out.push({ cls: spec.class ?? (spec.widget ? "point" : "?"), from, to });
  });
  return out;
}

describe("the reveal mark", () => {
  it("tints the passage and puts a bar beside every line it touches", () => {
    const from = DOC.indexOf("Zeile mit");
    const to = DOC.indexOf("dritte") + 6;
    const s = state().update({ effects: revealFlashEffects({ from, to, point: null }).show }).state;

    expect(marks(s)).toEqual([
      { cls: "schreibstube-reveal-line", from: DOC.indexOf("zweite"), to: DOC.indexOf("zweite") },
      { cls: "schreibstube-reveal-flash", from, to },
      { cls: "schreibstube-reveal-line", from: DOC.indexOf("dritte"), to: DOC.indexOf("dritte") }
    ]);
  });

  it("marks an insertion at its point, with a bar on its line and no tint", () => {
    const point = DOC.indexOf("mit");
    const s = state().update({
      effects: revealFlashEffects({ from: point, to: point, point }).show
    }).state;
    expect(marks(s).map((m) => m.cls)).toEqual(["schreibstube-reveal-line", "point"]);
  });

  it("does not bar the next line for a passage that ends at its start", () => {
    const from = DOC.indexOf("Erste");
    const to = DOC.indexOf("zweite");
    const s = state().update({ effects: revealFlashEffects({ from, to, point: null }).show }).state;
    expect(marks(s).filter((m) => m.cls === "schreibstube-reveal-line")).toHaveLength(1);
  });

  it("goes at the next edit", () => {
    const shown = state().update({
      effects: revealFlashEffects({ from: 0, to: 5, point: null }).show
    }).state;
    const edited = shown.update({ changes: { from: 0, insert: "x" } }).state;
    expect(marks(edited)).toEqual([]);
  });

  it("is cleared by its own timer, not by an earlier mark's", () => {
    const first = revealFlashEffects({ from: 0, to: 5, point: null });
    const second = revealFlashEffects({ from: 12, to: 18, point: null });
    let s = state().update({ effects: first.show }).state;
    s = s.update({ effects: second.show }).state;

    s = s.update({ effects: first.clear }).state;
    expect(marks(s).some((m) => m.cls === "schreibstube-reveal-flash")).toBe(true);

    s = s.update({ effects: second.clear }).state;
    expect(marks(s)).toEqual([]);
  });

  it("keeps to the document when the passage runs past its end", () => {
    const s = state().update({
      effects: revealFlashEffects({ from: DOC.length - 3, to: DOC.length + 50, point: null }).show
    }).state;
    expect(marks(s).find((m) => m.cls === "schreibstube-reveal-flash")?.to).toBe(DOC.length);
  });
});
