import type { MarkdownView } from "obsidian";
import { type OverlayRenderInput, OverlayController } from "../ui/overlay";
import { findOverlayHost } from "./overlay-host";

type OverlayControllerLike = {
  render: (input: OverlayRenderInput) => void;
  destroy: () => void;
  contains: (target: EventTarget | null) => boolean;
};

type CreateOverlayController = (
  host: HTMLElement,
  onNavigate: (lineNumber: number) => void
) => OverlayControllerLike;

export class OverlayCoordinator {
  private host: HTMLElement | null = null;
  private controller: OverlayControllerLike | null = null;
  private createController: CreateOverlayController;

  constructor(createController?: CreateOverlayController) {
    this.createController =
      createController ?? ((host, onNavigate) => new OverlayController(host, onNavigate));
  }

  renderForView(
    view: MarkdownView,
    input: OverlayRenderInput,
    onNavigate: (lineNumber: number) => void
  ): boolean {
    const nextHost = findOverlayHost(view);
    if (!nextHost) {
      this.clear();
      return false;
    }

    if (this.host !== nextHost) {
      this.clear();
      this.host = nextHost;
      this.controller = this.createController(nextHost, onNavigate);
    }

    this.controller?.render(input);
    return true;
  }

  clear(): void {
    this.controller?.destroy();
    this.controller = null;
    this.host = null;
  }

  contains(target: EventTarget | null): boolean {
    return this.controller?.contains(target) ?? false;
  }
}
