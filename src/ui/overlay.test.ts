// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Menu } from "../testing/obsidian-stub";
import { OverlayController } from "./overlay";
import type { HeadingIndex } from "../types";

const index: HeadingIndex = [
  { level: 1, text: "Nimbus", lineNumber: 0 },
  { level: 2, text: "Installation", lineNumber: 4 },
  { level: 2, text: "Usage", lineNumber: 10 },
  { level: 3, text: "Editor", lineNumber: 12 },
  { level: 4, text: "Tables", lineNumber: 14 },
  { level: 5, text: "Formulas", lineNumber: 16 },
  { level: 2, text: "FAQ", lineNumber: 30 }
];
const path = (...lines: number[]) => lines.map((line) => index.find((h) => h.lineNumber === line)!);

function setup() {
  const host = document.body.appendChild(document.createElement("div"));
  const navigate = vi.fn();
  const controller = new OverlayController(host, navigate);
  const crumbs = () =>
    Array.from(host.querySelectorAll<HTMLElement>(".schreibstube-overlay-crumb")).map(
      (el) => el.textContent
    );
  return { host, navigate, controller, crumbs };
}

afterEach(() => {
  document.body.innerHTML = "";
  Menu.last = null;
});

describe("the heading path", () => {
  it("shows the path in one line, the section being read marked as the place", () => {
    const { host, controller, crumbs } = setup();
    controller.render({ ancestorStack: path(0, 10, 12), headingIndex: index });

    expect(crumbs()).toEqual(["Nimbus", "Usage", "Editor"]);
    expect(host.querySelector('[aria-current="location"]')?.textContent).toBe("Editor");
    expect(host.querySelectorAll(".schreibstube-overlay-separator")).toHaveLength(2);
  });

  it("says where the section stands among its siblings", () => {
    const { host, controller } = setup();
    controller.render({ ancestorStack: path(0, 10), headingIndex: index });
    expect(host.querySelector(".schreibstube-overlay-position")?.textContent).toBe("§ 2/3");
  });

  it("opens the sections beside a crumb, and goes to the one chosen", () => {
    const { host, navigate, controller } = setup();
    controller.render({ ancestorStack: path(0, 10), headingIndex: index });

    host.querySelectorAll<HTMLElement>(".schreibstube-overlay-crumb")[1]?.click();
    const menu = Menu.last;
    expect(menu?.items.map((item) => [item.title, item.checked])).toEqual([
      ["Installation", false],
      ["Usage", true],
      ["FAQ", false]
    ]);

    menu?.items[2]?.click();
    expect(navigate).toHaveBeenCalledWith(30);
  });

  it("folds the middle of a path too long for the bar into one entry that opens it", () => {
    const { host, controller, crumbs } = setup();
    const nav = host.querySelector<HTMLElement>(".schreibstube-overlay-crumbs")!;
    // Each crumb takes 100 px; the bar has room for three.
    Object.defineProperty(nav, "clientWidth", { get: () => 300 });
    Object.defineProperty(nav, "scrollWidth", {
      get: () => nav.querySelectorAll(".schreibstube-overlay-crumb").length * 100
    });

    controller.render({ ancestorStack: path(0, 10, 12, 14, 16), headingIndex: index });
    expect(crumbs()).toEqual(["Nimbus", "…", "Formulas"]);

    host.querySelector<HTMLElement>(".schreibstube-overlay-more")?.click();
    expect(Menu.last?.items.map((item) => item.title)).toEqual(["Usage", "Editor", "Tables"]);
  });

  it("is hidden above the first heading", () => {
    const { host, controller } = setup();
    controller.render({ ancestorStack: [], headingIndex: index });
    expect(host.querySelector(".schreibstube-overlay")?.classList.contains("is-hidden")).toBe(true);
  });

  it("takes neither the focus nor the cursor from the text when pressed", () => {
    const { host, controller } = setup();
    controller.render({ ancestorStack: path(0), headingIndex: index });
    const press = new Event("pointerdown", { bubbles: true, cancelable: true });
    host.querySelector(".schreibstube-overlay-crumb")?.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
  });

  it("leaves its host as it found it", () => {
    const { host, controller } = setup();
    controller.destroy();
    expect(host.querySelector(".schreibstube-overlay")).toBeNull();
    expect(host.classList.contains("schreibstube-overlay-host")).toBe(false);
  });
});
