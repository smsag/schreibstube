export function findOverlayHost(container: ParentNode): HTMLElement | null {
  const editorScroller = container.querySelector(".cm-scroller") as HTMLElement | null;
  if (editorScroller) {
    return editorScroller;
  }

  return container.querySelector(".markdown-reading-view") as HTMLElement | null;
}
