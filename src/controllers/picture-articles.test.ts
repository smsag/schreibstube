import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { fakeVault } from "../testing/fake-app";
import { createLogger } from "../services/logger";
import { DESCRIPTION_KEYS } from "../services/image-description";
import {
  ARTICLE_PASS_DELAY_MS,
  MAX_ARTICLE_WRITES_PER_PASS,
  PictureArticleLinker
} from "./picture-articles";

const PICTURE = "Anhänge/harness.png";
const DESCRIPTION = "Bildbeschreibungen/harness.png – 1a2b3c4d.md";
const ARTICLE = "Artikel/How a Harness Works.md";

/**
 * A vault with one described picture, the link table Obsidian would hold for
 * it, and timers a test fires by hand.
 */
function setup(
  options: {
    links?: Record<string, Record<string, number>>;
    articles?: unknown;
    described?: Map<string, string>;
    notes?: string[];
  } = {}
) {
  const described = options.described ?? new Map([[DESCRIPTION, PICTURE]]);
  const vault = fakeVault({
    notes: [
      ...[...described.keys()].map((path) => ({
        path,
        content: "",
        frontmatter: {
          [DESCRIPTION_KEYS.image]: `[[${described.get(path) ?? ""}]]`,
          ...(options.articles !== undefined
            ? { [DESCRIPTION_KEYS.articles]: options.articles }
            : {})
        }
      })),
      ...[ARTICLE, ...(options.notes ?? [])].map((path) => ({ path, content: "" }))
    ],
    binaries: [{ path: PICTURE, bytes: new Uint8Array([1]) }]
  });
  const write = vi.spyOn(vault.app.fileManager, "processFrontMatter");
  const app = {
    ...vault.app,
    vault: { ...vault.app.vault, getFileByPath: vault.app.vault.getAbstractFileByPath },
    metadataCache: {
      ...vault.app.metadataCache,
      resolvedLinks: options.links ?? {
        [DESCRIPTION]: { [PICTURE]: 2 },
        [ARTICLE]: { [PICTURE]: 1 }
      }
    }
  };
  const timers: (() => void)[] = [];
  const hooks = {
    describedPictures: () => described,
    isDescriptionNote: (path: string) => described.has(path),
    setTimer: vi.fn((callback: () => void, _ms: number) => {
      timers.push(callback);
      return timers.length - 1;
    }),
    clearTimer: vi.fn((handle: unknown) => {
      timers[handle as number] = () => {};
    })
  };
  const linker = new PictureArticleLinker(
    app as unknown as App,
    hooks,
    createLogger(() => false)
  );
  return { vault, linker, write, hooks, timers };
}

const articlesIn = (v: ReturnType<typeof fakeVault>, path = DESCRIPTION) =>
  v.frontmatterOf(path)[DESCRIPTION_KEYS.articles];

describe("PictureArticleLinker", () => {
  it("names the article in the description, never the description itself", async () => {
    const { vault, linker } = setup();
    await linker.pass();
    expect(articlesIn(vault)).toEqual(["[[Artikel/How a Harness Works]]"]);
  });

  it("writes an empty list for a picture no article uses", async () => {
    const { vault, linker } = setup({ links: { [DESCRIPTION]: { [PICTURE]: 2 } } });
    await linker.pass();
    expect(articlesIn(vault)).toEqual([]);
  });

  it("leaves a description that already says the right thing unwritten", async () => {
    const { linker, write } = setup({ articles: ["[[Artikel/How a Harness Works]]"] });
    await linker.pass();
    expect(write).not.toHaveBeenCalled();
  });

  it("corrects a list somebody edited", async () => {
    const { vault, linker } = setup({ articles: ["[[Woanders]]"] });
    await linker.pass();
    expect(articlesIn(vault)).toEqual(["[[Artikel/How a Harness Works]]"]);
  });

  it("writes at most the bound in one pass, and asks for another for the rest", async () => {
    const count = MAX_ARTICLE_WRITES_PER_PASS + 2;
    const described = new Map(
      Array.from({ length: count }, (_, i) => [`B/${i}.md`, `Anhänge/${i}.png`] as const)
    );
    const { linker, write, hooks, timers } = setup({ described, links: {} });

    await linker.pass();
    expect(write).toHaveBeenCalledTimes(MAX_ARTICLE_WRITES_PER_PASS);
    expect(hooks.setTimer).toHaveBeenLastCalledWith(expect.any(Function), ARTICLE_PASS_DELAY_MS);

    timers.at(-1)?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(write).toHaveBeenCalledTimes(count);
  });

  it("runs one pass for a burst of changes", async () => {
    const { linker, write, hooks, timers } = setup();
    linker.schedule();
    linker.schedule();
    linker.schedule();
    expect(hooks.clearTimer).toHaveBeenCalledTimes(2);
    for (const fire of timers) fire();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("does nothing once stopped", async () => {
    const { linker, write, hooks } = setup();
    linker.stop();
    linker.schedule();
    await linker.pass();
    expect(hooks.setTimer).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("asks again for a change that arrived while a pass was writing", async () => {
    const { linker, hooks } = setup();
    const first = linker.pass();
    await linker.pass();
    await first;
    expect(hooks.setTimer).toHaveBeenCalledTimes(1);
  });
});
