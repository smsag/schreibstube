import type { MarkdownView } from "obsidian";
import type { HeadingIndex } from "../types";
import {
  getRenderedHeadingIndexForSourceLine,
  resolveViewportLineFromRenderedHeadings
} from "./reading-headings";

function getPreviewRoot(view: MarkdownView): HTMLElement | null {
  return view.containerEl.querySelector(
    ".markdown-preview-view"
  ) as HTMLElement | null;
}

function getRenderedHeadings(previewRoot: HTMLElement): HTMLElement[] {
  return Array.from(
    previewRoot.querySelectorAll("h1, h2, h3, h4, h5, h6")
  ) as HTMLElement[];
}

export function resolveViewportLineForReadingView(
  view: MarkdownView,
  headingIndex: HeadingIndex,
  fallbackLine: number,
  scrollTop: number
): number {
  if (view.getMode() !== "preview") {
    return fallbackLine;
  }

  const previewRoot = getPreviewRoot(view);
  if (!previewRoot) {
    return fallbackLine;
  }

  const renderedOffsets = getRenderedHeadings(previewRoot).map(
    (heading) => heading.offsetTop
  );

  return resolveViewportLineFromRenderedHeadings(
    headingIndex,
    renderedOffsets,
    scrollTop,
    fallbackLine
  );
}

export function scrollReadingHeadingIntoView(
  view: MarkdownView,
  headingIndex: HeadingIndex,
  lineNumber: number
): boolean {
  if (view.getMode() !== "preview") {
    return false;
  }

  const previewRoot = getPreviewRoot(view);
  if (!previewRoot) {
    return false;
  }

  const sourceIndex = getRenderedHeadingIndexForSourceLine(headingIndex, lineNumber);
  if (sourceIndex < 0) {
    return false;
  }

  const renderedHeadings = getRenderedHeadings(previewRoot);
  const target = renderedHeadings[sourceIndex];

  if (!target) {
    return false;
  }

  target.scrollIntoView({ block: "start", behavior: "instant" });
  return true;
}
