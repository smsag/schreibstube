import { describe, expect, it } from "vitest";
import { BUILTIN_TEMPLATE_FOLDER, BUILTIN_TEMPLATE_NAME, builtinTemplate } from "./print-builtin";
import { checkLayout } from "./print-template";

describe("builtinTemplate", () => {
  const builtIn = builtinTemplate();

  it("is carried, named Standard, and marked as not being in the vault", () => {
    expect(builtIn?.template).toMatchObject({
      name: BUILTIN_TEMPLATE_NAME,
      folder: BUILTIN_TEMPLATE_FOLDER,
      entry: "standard",
      builtIn: true
    });
  });

  it("lives at a path no vault can hold", () => {
    // Obsidian refuses a colon in a file or folder name.
    expect(BUILTIN_TEMPLATE_FOLDER).toContain(":");
  });

  it("brings a layout that defines its entry and passes the checks a vault template must", () => {
    expect(builtIn?.layout).toContain("#let standard(body, data)");
    expect(checkLayout(builtIn?.layout ?? "")).toEqual([]);
  });

  it("reads nothing a note has to set: only the title and the language", () => {
    const keys = [...(builtIn?.layout ?? "").matchAll(/data\.(\w+)/g)].map((match) => match[1]);
    expect(new Set(keys)).toEqual(new Set(["title", "lang"]));
  });
});
