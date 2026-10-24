// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { PropertyWidgetControls } from "./property-widget-controls";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A window of its own with one Properties widget in it, as a pop-out has. */
function popout(): { win: Window; widget: HTMLElement } {
  const doc = document.implementation.createHTMLDocument("pop-out");
  const widget = doc.body.appendChild(doc.createElement("div"));
  widget.className = "metadata-container";
  widget.appendChild(doc.createElement("div")).className = "metadata-add-button";
  return { win: { document: doc } as unknown as Window, widget };
}

function controls(): PropertyWidgetControls {
  const app = { workspace: { getActiveFile: () => null, iterateAllLeaves: () => {} } };
  return new PropertyWidgetControls(app as unknown as App, [
    {
      className: "add-set",
      icon: "list-plus",
      label: () => "Set",
      ariaLabel: () => "Add set",
      press: () => {}
    }
  ]);
}

describe("PropertyWidgetControls", () => {
  it("puts a control back when the widget is rebuilt without it", async () => {
    const { win, widget } = popout();
    const widgetControls = controls();
    widgetControls.attach(win, () => {});
    widget.querySelector(".add-set")?.remove();
    await settle();
    expect(widget.querySelectorAll(".add-set")).toHaveLength(1);
  });

  it("stops watching a window's widgets once the window is closed", async () => {
    const { win, widget } = popout();
    const widgetControls = controls();
    widgetControls.attach(win, () => {});
    widgetControls.detach(win);
    widget.querySelector(".add-set")?.remove();
    await settle();
    expect(widget.querySelectorAll(".add-set")).toHaveLength(0);
  });
});
