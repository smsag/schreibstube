// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { OBSIDIAN_BUTTON_RULES, SENTINEL } from "../testing/obsidian-button-rules";

/**
 * Obsidian's own button rules must not change a Schreibstube button.
 *
 * Every hand-built button wears one of the nine roles in `styles.css`, and Obsidian's
 * app.css sets a fill, a label colour, a height, a radius, a shadow and — on a
 * tablet or in a phone modal — a padding and a width on every `button` in the
 * document. The roles claim each of those properties; this proves they win.
 *
 * The fixture holds the ten rules that can reach a button, with SENTINEL
 * values, loaded BEFORE styles.css exactly as Obsidian loads app.css before a
 * plugin's sheet. A sentinel reaching a computed style means their rule won.
 *
 * happy-dom cannot hover, so `:hover` becomes a class of the same specificity;
 * `(hover: hover)` counts as a mouse and `(pointer: coarse)` as not a phone.
 * A var() whose fallback is another var() is flattened, because happy-dom
 * resolves only one level.
 */
const HOVER = ".is-hovered";
const prep = (text: string): string =>
  text
    .replace(
      /@media \(hover: hover\)( and \(prefers-reduced-motion: no-preference\))? \{/g,
      "@media all {"
    )
    .replace(/@media \(pointer: coarse\) \{/g, "@media (max-width: 1px) {")
    .replace(/:hover/g, HOVER)
    .replace(/var\(--btn-[\w-]+, (var\(--[\w-]+\))\)/g, "$1");

const PLUGIN = prep(readFileSync(resolve(process.cwd(), "styles.css"), "utf8"));
const OBSIDIAN = prep(OBSIDIAN_BUTTON_RULES);

const VARS: Record<string, string> = {
  "--color-accent": "rgb(90, 80, 200)",
  "--text-on-accent": "rgb(255, 255, 255)",
  "--text-normal": "rgb(34, 34, 34)",
  "--text-muted": "rgb(92, 92, 92)",
  "--text-faint": "rgb(171, 171, 171)",
  "--text-error": "rgb(200, 40, 40)",
  "--color-orange": "rgb(200, 110, 0)",
  "--background-modifier-hover": "rgb(236, 236, 236)",
  "--background-modifier-border": "rgb(224, 224, 224)",
  "--background-secondary": "rgb(246, 246, 246)",
  "--s1": "4px",
  "--s2": "8px",
  "--font-smaller": "11px",
  "--font-monospace": "monospace",
  "--font-interface": "sans-serif"
};

/** Mount `html` inside the chain of wrappers Obsidian actually nests it in. */
function mount(bodyCls: string, chain: string[], html: string): HTMLElement {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.body.className = bodyCls;
  for (const [key, value] of Object.entries(VARS)) document.body.style.setProperty(key, value);
  for (const text of [OBSIDIAN, PLUGIN]) {
    const style = document.createElement("style");
    style.textContent = text;
    document.head.appendChild(style);
  }
  let host: HTMLElement = document.body;
  for (const cls of chain) {
    const div = document.createElement("div");
    div.className = cls;
    host.appendChild(div);
    host = div;
  }
  host.innerHTML = html;
  return host;
}

const REVIEW = ["workspace-leaf-content", "view-content schreibstube-review"];
const EXPLORER = ["workspace-leaf-content", "view-content schreibstube-explorer"];
const PHONE_PICKER = [
  "modal-container",
  "modal",
  "modal-content schreibstube-icon-picker",
  "setting-item",
  "setting-item-control"
];

/** One of each role, wearing the layout class it actually carries in the view. */
const REVIEW_BUTTONS = [
  "sb sb-primary schreibstube-review-button",
  "sb sb-secondary schreibstube-review-button",
  "sb sb-quiet schreibstube-review-button",
  "sb sb-destructive schreibstube-review-button",
  "sb sb-seg schreibstube-review-chip",
  "sb sb-seg schreibstube-review-chip active"
];

function expectNoLeak(button: HTMLElement, where: string): void {
  const cs = getComputedStyle(button);
  const at = `${button.className} (${where})`;
  expect(cs.height, `${at}: height`).not.toBe(SENTINEL.height);
  expect(`${cs.paddingTop} ${cs.paddingRight}`, `${at}: tablet padding`).not.toBe(
    SENTINEL.tabletPadding
  );
  expect(cs.paddingTop, `${at}: phone padding`).not.toBe(SENTINEL.phonePadding);
  expect(cs.width, `${at}: phone width`).not.toBe(SENTINEL.phoneWidth);
  expect(cs.borderTopLeftRadius, `${at}: radius`).not.toBe(SENTINEL.radius);
  expect(cs.fontWeight, `${at}: weight`).not.toBe("700");
  expect(cs.boxShadow, `${at}: shadow`).not.toBe(SENTINEL.shadow);
  expect(cs.color, `${at}: label`).not.toBe(SENTINEL.label);
  expect([SENTINEL.fill, SENTINEL.hoverFill], `${at}: fill`).not.toContain(cs.backgroundColor);
}

describe("Obsidian's button rules never reach a Schreibstube button", () => {
  for (const [bodyCls, label] of [
    ["is-desktop", "desktop"],
    ["is-mobile is-tablet", "tablet"]
  ] as const) {
    for (const hovered of [false, true]) {
      it(`${label}${hovered ? ", hovered" : ""}: the review panel's roles keep their box, label and fill`, () => {
        const host = mount(
          bodyCls,
          REVIEW,
          REVIEW_BUTTONS.map(
            (cls) => `<button class="${cls}${hovered ? " is-hovered" : ""}">Label</button>`
          ).join("")
        );
        for (const button of Array.from(host.querySelectorAll<HTMLElement>("button"))) {
          expectNoLeak(button, label);
        }
      });
    }
  }

  it("the explorer's clear ✕ keeps the icon role's box, not Obsidian's", () => {
    const host = mount(
      "is-desktop",
      EXPLORER,
      `<div class="schreibstube-explorer-filter-row"><button class="sb sb-icon schreibstube-explorer-filter-clear schreibstube-icon">x</button></div>`
    );
    const button = host.querySelector<HTMLElement>("button")!;
    expectNoLeak(button, "explorer");
    // The ✕ is a glyph of the bundled icon font, not an SVG, so the font and
    // the size are the picture. The role base names both at (0,2,0) and
    // out-ranks `.schreibstube-icon` — which drew the glyph as a blank box.
    const cs = getComputedStyle(button);
    expect(cs.fontFamily).toContain("schreibstube-icons");
    expect(cs.fontSize).toBe("14px");
  });

  it("phone picker: the Setting control neither stretches nor re-pads a segment", () => {
    const host = mount(
      "is-mobile is-phone",
      PHONE_PICKER,
      `<button class="sb sb-seg schreibstube-icon-choice">A</button><button class="sb sb-seg schreibstube-icon-choice active">B</button>`
    );
    for (const button of Array.from(host.querySelectorAll<HTMLElement>("button"))) {
      expectNoLeak(button, "phone picker");
    }
  });

  it("a disabled button is dimmed by the role set, never by core's button[disabled]", () => {
    // The kit owns the disabled look: a primary stays readable (it carries the
    // "working…" label), everything else dims to 0.5. Core's 0.7 is the value
    // that must never appear — it would mean its rule won.
    const host = mount(
      "is-desktop",
      REVIEW,
      `<button class="sb sb-primary schreibstube-review-button" disabled>Prüfe…</button>` +
        `<button class="sb sb-secondary schreibstube-review-button" disabled>Prüfen</button>`
    );
    const [primary, secondary] = Array.from(host.querySelectorAll<HTMLElement>("button"));
    expect(getComputedStyle(primary!).opacity).toBe("1");
    expect(getComputedStyle(secondary!).opacity).toBe("0.5");
  });

  it("`hidden` hides a button even though the role base sets display", () => {
    const host = mount(
      "is-desktop",
      EXPLORER,
      `<button class="sb sb-icon schreibstube-explorer-filter-clear schreibstube-icon" hidden>x</button>`
    );
    expect(getComputedStyle(host.querySelector("button")!).display).toBe("none");
  });
});
