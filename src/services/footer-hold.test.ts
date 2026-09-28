import { describe, expect, it } from "vitest";
import { FooterHold } from "./footer-hold";

type View = { id: string };
type File = { path: string };

function setup() {
  const hold = new FooterHold<View, File>();
  const note: File = { path: "Untitled.md" };
  const other: File = { path: "b.md" };
  const view: View = { id: "popout" };
  const second: View = { id: "tab" };
  return { hold, note, other, view, second };
}

describe("FooterHold", () => {
  it("holds nothing it was not asked to", () => {
    const { hold, note, view } = setup();
    expect(hold.isHeld(view, note)).toBe(false);
    expect(hold.isHeld(view, null)).toBe(false);
  });

  it("holds the note in the first view that shows it, for as long as it shows it", () => {
    const { hold, note, view } = setup();
    hold.hold(note);

    expect(hold.isHeld(view, note)).toBe(true);
    // Every later sync of the same view: a rename keeps the file, a switch
    // to Reading view keeps the view.
    expect(hold.isHeld(view, note)).toBe(true);
    note.path = "Kapitel 1.md";
    expect(hold.isHeld(view, note)).toBe(true);
  });

  it("does not hold the note in a second view: that is opening it again", () => {
    const { hold, note, view, second } = setup();
    hold.hold(note);
    hold.isHeld(view, note);

    expect(hold.isHeld(second, note)).toBe(false);
  });

  it("ends when the view moves to another note, and does not come back with the note", () => {
    const { hold, note, other, view } = setup();
    hold.hold(note);
    hold.isHeld(view, note);

    expect(hold.isHeld(view, other)).toBe(false);
    expect(hold.isHeld(view, note)).toBe(false);
  });

  it("ends when the view closes", () => {
    const { hold, note, view } = setup();
    hold.hold(note);
    hold.isHeld(view, note);

    hold.keepOnly(new Set());

    expect(hold.isHeld(view, note)).toBe(false);
  });

  it("keeps the holds of views still open", () => {
    const { hold, note, view } = setup();
    hold.hold(note);
    hold.isHeld(view, note);

    hold.keepOnly(new Set([view]));

    expect(hold.isHeld(view, note)).toBe(true);
  });

  it("lets go of a hold no view claimed, so the next open shows the footer", () => {
    const { hold, note, view } = setup();
    hold.hold(note);

    hold.release(note);

    expect(hold.isHeld(view, note)).toBe(false);
  });

  it("keeps a claimed hold when the unclaimed rest is let go", () => {
    const { hold, note, view } = setup();
    hold.hold(note);
    hold.isHeld(view, note);

    hold.release(note);

    expect(hold.isHeld(view, note)).toBe(true);
  });
});
