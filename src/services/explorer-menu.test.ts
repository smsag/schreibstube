import { describe, expect, it } from "vitest";
import { setLanguage } from "../i18n";
import { syncBadgeFor, syncBadgeIcon } from "./explorer-badge";
import { buildExplorerMenu, type ExplorerTarget } from "./explorer-menu";

setLanguage("en");

function target(overrides: Partial<ExplorerTarget> = {}): ExplorerTarget {
  return {
    kind: "file",
    path: "Objekte/Haus.md",
    markdown: true,
    hasIcon: false,
    pinned: false,
    sync: "none",
    ...overrides
  };
}

function ids(sections: ReturnType<typeof buildExplorerMenu>): string[] {
  return sections.flatMap((section) => section.items.map((item) => item.id));
}

describe("buildExplorerMenu", () => {
  it("leads with opening the file and ends with the other plugins", () => {
    const sections = buildExplorerMenu(target(), "submenu");

    expect(sections[0].items.map((item) => item.id)).toEqual(["open", "open-new-tab"]);
    expect(sections[sections.length - 1]).toEqual({
      id: "plugins",
      items: [{ id: "more", label: "More actions", icon: "more-horizontal" }]
    });
  });

  it("leaves the other plugins out when they are turned off", () => {
    expect(ids(buildExplorerMenu(target(), "off"))).not.toContain("more");
  });

  it("offers to remove an icon only when there is one", () => {
    expect(ids(buildExplorerMenu(target(), "off"))).not.toContain("clear-icon");
    expect(ids(buildExplorerMenu(target({ hasIcon: true }), "off"))).toContain("clear-icon");
  });

  it("names the icon action for what it does", () => {
    const [set] = buildExplorerMenu(target(), "off")[1].items;
    const [change] = buildExplorerMenu(target({ hasIcon: true }), "off")[1].items;

    expect(set.label).toBe("Set icon…");
    expect(change.label).toBe("Change icon…");
  });

  it("offers the opposite of the current pin state", () => {
    expect(ids(buildExplorerMenu(target(), "off"))).toContain("pin");
    expect(ids(buildExplorerMenu(target({ pinned: true }), "off"))).toContain("unpin");
  });

  it("offers to bind an unbound note, and to refresh a bound one", () => {
    expect(ids(buildExplorerMenu(target(), "off"))).toContain("bind-source");

    const bound = ids(buildExplorerMenu(target({ sync: "synced" }), "off"));
    expect(bound).toEqual(expect.arrayContaining(["check-source", "open-source", "unbind-source"]));
    expect(bound).not.toContain("bind-source");
  });

  it("offers a note bound to something broken the same repair actions", () => {
    expect(ids(buildExplorerMenu(target({ sync: "error" }), "off"))).toContain("unbind-source");
  });

  it("says nothing about sync for an attachment", () => {
    const sections = buildExplorerMenu(target({ markdown: false, path: "Bilder/plan.png" }), "off");

    expect(sections.map((section) => section.id)).not.toContain("sync");
  });

  it("gives a folder its own actions and no open entry", () => {
    const sections = buildExplorerMenu(
      target({ kind: "folder", path: "Objekte", markdown: false, hasBoundNotes: true }),
      "off"
    );

    expect(ids(sections)).toEqual([
      "set-icon",
      "pin",
      "sync-folder",
      "new-note",
      "new-folder",
      "rename",
      "delete"
    ]);
  });

  it("leaves out the folder sync action when nothing under it is bound", () => {
    const sections = buildExplorerMenu(
      target({ kind: "folder", path: "Objekte", markdown: false, hasBoundNotes: false }),
      "off"
    );

    expect(ids(sections)).not.toContain("sync-folder");
  });

  it("marks deleting as the destructive one", () => {
    const file = buildExplorerMenu(target(), "off").find((section) => section.id === "file");

    expect(file?.items.find((item) => item.id === "delete")?.warning).toBe(true);
    expect(file?.items.find((item) => item.id === "rename")?.warning).toBeUndefined();
  });
});

describe("syncBadgeFor", () => {
  const record = { hash: "abc", etag: "", checkedAt: Date.UTC(2026, 8, 12) };

  it("shows nothing for a note without a binding", () => {
    expect(syncBadgeFor({ bound: false, sourceValid: false })).toBe("none");
    expect(syncBadgeIcon("none")).toBe("");
  });

  it("calls out a binding the plugin cannot fetch", () => {
    expect(syncBadgeFor({ bound: true, sourceValid: false })).toBe("error");
  });

  it("separates never checked from checked and clean", () => {
    expect(syncBadgeFor({ bound: true, sourceValid: true })).toBe("unchecked");
    expect(
      syncBadgeFor({ bound: true, sourceValid: true, record: { ...record, checkedAt: 0 } })
    ).toBe("unchecked");
    expect(syncBadgeFor({ bound: true, sourceValid: true, record })).toBe("synced");
  });

  it("shows waiting changes the poll found", () => {
    expect(
      syncBadgeFor({ bound: true, sourceValid: true, record: { ...record, pendingChanges: 3 } })
    ).toBe("pending");
  });

  it("has a glyph for every state that shows one", () => {
    for (const badge of ["synced", "pending", "unchecked", "error"] as const) {
      expect(syncBadgeIcon(badge)).not.toBe("");
    }
  });
});
