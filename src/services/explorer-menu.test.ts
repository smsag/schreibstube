import { describe, expect, it } from "vitest";
import { setLanguage } from "../i18n";
import { syncBadgeFor, syncBadgeIcon } from "./explorer-badge";
import {
  LONG_PRESS_ECHO_MS,
  isLongPressEcho,
  buildExplorerMenu,
  buildSelectionMenu,
  buildTagPinMenu,
  type ExplorerTarget
} from "./explorer-menu";

setLanguage("en");

function target(overrides: Partial<ExplorerTarget> = {}): ExplorerTarget {
  return {
    kind: "file",
    path: "Objekte/Haus.md",
    markdown: true,
    hasIcon: false,
    kept: false,
    pinned: false,
    bound: false,
    ...overrides
  };
}

function ids(sections: ReturnType<typeof buildExplorerMenu>): string[] {
  return sections.flatMap((section) => section.items.map((item) => item.id));
}

describe("buildExplorerMenu", () => {
  it("offers related notes on a note and on nothing else", () => {
    expect(ids(buildExplorerMenu(target(), "off"))).toContain("related");
    // An attachment carries no links and no tags to be related by.
    expect(ids(buildExplorerMenu(target({ markdown: false }), "off"))).not.toContain("related");
    expect(ids(buildExplorerMenu(target({ kind: "folder" }), "off"))).not.toContain("related");
  });

  it("leads with opening the file and ends with the other plugins", () => {
    const sections = buildExplorerMenu(target(), "submenu");

    expect(sections[0]?.items.map((item) => item.id)).toEqual(["open", "open-new-tab", "related"]);
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
    const [set] = buildExplorerMenu(target(), "off")[1]?.items ?? [];
    const [change] = buildExplorerMenu(target({ hasIcon: true }), "off")[1]?.items ?? [];

    expect(set?.label).toBe("Set icon…");
    expect(change?.label).toBe("Change icon…");
  });

  it("offers the opposite of the current pin state", () => {
    expect(ids(buildExplorerMenu(target(), "off"))).toContain("pin");
    expect(ids(buildExplorerMenu(target({ pinned: true }), "off"))).toContain("unpin");
  });

  it("offers the two marks separately, the folder's top first", () => {
    const [, appearance] = buildExplorerMenu(target(), "off");

    expect(appearance?.items.map((item) => item.id)).toEqual(["set-icon", "keep-top", "pin"]);
  });

  it("offers the opposite of the current top state, whatever the pin says", () => {
    expect(ids(buildExplorerMenu(target({ kept: true }), "off"))).toContain("release-top");
    expect(ids(buildExplorerMenu(target({ kept: true, pinned: true }), "off"))).toEqual(
      expect.arrayContaining(["release-top", "unpin"])
    );
    expect(ids(buildExplorerMenu(target({ pinned: true }), "off"))).toContain("keep-top");
  });

  it("offers to bind an unbound note, and to refresh a bound one", () => {
    expect(ids(buildExplorerMenu(target(), "off"))).toContain("bind-source");

    const bound = ids(buildExplorerMenu(target({ bound: true }), "off"));
    expect(bound).toEqual(expect.arrayContaining(["check-source", "open-source", "unbind-source"]));
    expect(bound).not.toContain("bind-source");
  });

  it("goes by the binding, so a bound note keeps its actions while sync is off", () => {
    // The badge is hidden while document sync is switched off. A menu that read
    // it offered a bound note nothing but "Bind source": no manual check, and
    // no way back out of the binding.
    const bound = ids(buildExplorerMenu(target({ bound: true }), "off"));

    expect(bound).toContain("check-source");
    expect(bound).toContain("unbind-source");
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
      "keep-top",
      "pin",
      "sync-folder",
      "new-note",
      "new-folder",
      "copy-path",
      "move",
      "rename",
      "delete"
    ]);
  });

  it("offers copy-path on a folder and never on a file", () => {
    const folder = buildExplorerMenu(target({ kind: "folder", markdown: false }), "off");
    const file = buildExplorerMenu(target({ path: "Notizen/Brief.md" }), "off");

    expect(ids(folder)).toContain("copy-path");
    expect(ids(file)).not.toContain("copy-path");
  });

  it("leaves out the folder sync action when nothing under it is bound", () => {
    const sections = buildExplorerMenu(
      target({ kind: "folder", path: "Objekte", markdown: false, hasBoundNotes: false }),
      "off"
    );

    expect(ids(sections)).not.toContain("sync-folder");
  });

  it("offers a move on the file block, above renaming", () => {
    const file = buildExplorerMenu(target(), "off").find((section) => section.id === "file");

    expect(file?.items.map((item) => item.id)).toEqual(["move", "rename", "rename-ai", "delete"]);
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

describe("isLongPressEcho", () => {
  it("is not an echo when the pane has answered nothing", () => {
    // A right click: the timer never ran, so there is nothing to be an echo of.
    expect(isLongPressEcho(1000, null)).toBe(false);
  });

  it("recognises the browser's context menu for a press already answered", () => {
    expect(isLongPressEcho(1000 + 300, 1000)).toBe(true);
  });

  it("stops recognising it once the window has passed", () => {
    expect(isLongPressEcho(1000 + LONG_PRESS_ECHO_MS, 1000)).toBe(false);
  });

  it("lets a second right click on the same row open again at once", () => {
    // Nothing answered it, however recently the last menu was opened.
    expect(isLongPressEcho(1001, null)).toBe(false);
  });
});

describe("naming a file from what is inside it", () => {
  function fileItems(overrides: Partial<ExplorerTarget>) {
    return buildExplorerMenu(target(overrides), "off")
      .find((section) => section.id === "file")
      ?.items.filter((item) => item.id === "rename-ai");
  }

  it("offers to read a note", () => {
    expect(fileItems({ markdown: true })).toEqual([
      { id: "rename-ai", label: "Rename from the text…", icon: "wand-2" }
    ]);
  });

  it("offers to look at a picture, and says so", () => {
    // One entry, two wordings: which of the two things happens is the file's
    // to decide, and a label covering both would name neither.
    expect(fileItems({ markdown: false, image: true })).toEqual([
      { id: "rename-ai", label: "Rename from the picture…", icon: "wand-2" }
    ]);
  });

  it("offers nothing on a file neither path can read", () => {
    expect(fileItems({ markdown: false, image: false })).toEqual([]);
    expect(fileItems({ path: "Vertrag.pdf", markdown: false })).toEqual([]);
  });

  it("offers nothing on a folder, which has no contents of that kind", () => {
    expect(fileItems({ kind: "folder", markdown: false, image: true })).toEqual([]);
  });
});

describe("pinning a tag", () => {
  it("is offered on a note that carries a tag, after the note's own pin", () => {
    const appearance = buildExplorerMenu(target({ tagged: true }), "off").find(
      (section) => section.id === "appearance"
    );
    expect(appearance?.items.map((item) => item.id).slice(-2)).toEqual(["pin", "pin-tag"]);
  });

  it("is not offered on a note without tags, an attachment or a folder", () => {
    expect(ids(buildExplorerMenu(target(), "off"))).not.toContain("pin-tag");
    expect(ids(buildExplorerMenu(target({ markdown: false, tagged: true }), "off"))).not.toContain(
      "pin-tag"
    );
    expect(ids(buildExplorerMenu(target({ kind: "folder", tagged: true }), "off"))).not.toContain(
      "pin-tag"
    );
  });

  it("gives a pinned tag its list and a way out", () => {
    expect(buildTagPinMenu().map((item) => item.id)).toEqual(["show-tag", "unpin-tag"]);
  });
});

describe("buildSelectionMenu", () => {
  it("offers only what makes sense for several rows at once: move and delete", () => {
    const items = buildSelectionMenu(3);

    expect(items.map((item) => item.id)).toEqual(["move-selected", "delete-selected"]);
  });

  it("says how many rows the action will touch", () => {
    for (const item of buildSelectionMenu(3)) expect(item.label).toContain("3");
  });

  it("marks the delete as destructive, so the view colours it", () => {
    expect(buildSelectionMenu(2).find((item) => item.id === "delete-selected")?.warning).toBe(true);
  });
});
