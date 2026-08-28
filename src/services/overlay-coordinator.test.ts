import { describe, expect, it, vi } from "vitest";
import type { MarkdownView } from "obsidian";
import { OverlayCoordinator } from "./overlay-coordinator";

describe("OverlayCoordinator", () => {
  it("reuses existing controller when host is unchanged", () => {
    const host = { id: "host" } as unknown as HTMLElement;
    const createSpy = vi.fn(() => ({
      render: vi.fn(),
      destroy: vi.fn(),
      contains: vi.fn().mockReturnValue(false)
    }));

    const coordinator = new OverlayCoordinator(createSpy);
    const view = {
      contentEl: {
        querySelector: (selector: string) =>
          selector === ".markdown-source-view.mod-cm6" ? host : null
      }
    } as unknown as MarkdownView;

    const input = {
      ancestorStack: []
    };

    coordinator.renderForView(view, input, () => {});
    coordinator.renderForView(view, input, () => {});

    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it("recreates controller when host changes", () => {
    const hostA = { id: "a" } as unknown as HTMLElement;
    const hostB = { id: "b" } as unknown as HTMLElement;
    const destroyA = vi.fn();

    const createSpy = vi
      .fn()
      .mockReturnValueOnce({
        render: vi.fn(),
        destroy: destroyA,
        contains: vi.fn().mockReturnValue(false)
      })
      .mockReturnValueOnce({
        render: vi.fn(),
        destroy: vi.fn(),
        contains: vi.fn().mockReturnValue(false)
      });

    const coordinator = new OverlayCoordinator(createSpy);

    const viewA = {
      contentEl: {
        querySelector: (selector: string) =>
          selector === ".markdown-source-view.mod-cm6" ? hostA : null
      }
    } as unknown as MarkdownView;

    const viewB = {
      contentEl: {
        querySelector: (selector: string) =>
          selector === ".markdown-source-view.mod-cm6" ? hostB : null
      }
    } as unknown as MarkdownView;

    const input = {
      ancestorStack: []
    };

    coordinator.renderForView(viewA, input, () => {});
    coordinator.renderForView(viewB, input, () => {});

    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(destroyA).toHaveBeenCalledTimes(1);
  });

  it("clears controller when host is unavailable", () => {
    const destroySpy = vi.fn();
    const createSpy = vi.fn(() => ({
      render: vi.fn(),
      destroy: destroySpy,
      contains: vi.fn().mockReturnValue(false)
    }));

    const coordinator = new OverlayCoordinator(createSpy);

    const withHost = {
      contentEl: {
        querySelector: (selector: string) =>
          selector === ".markdown-source-view.mod-cm6" ? ({} as HTMLElement) : null
      }
    } as unknown as MarkdownView;

    const noHost = {
      contentEl: null
    } as unknown as MarkdownView;

    const input = {
      ancestorStack: []
    };

    coordinator.renderForView(withHost, input, () => {});
    const rendered = coordinator.renderForView(noHost, input, () => {});

    expect(rendered).toBe(false);
    expect(destroySpy).toHaveBeenCalledTimes(1);
  });
});
