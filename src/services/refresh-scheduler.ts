export interface RefreshOptions {
  readingScrollTop?: number;
}

export interface RefreshPayload {
  viewportTopLine?: number;
  options?: RefreshOptions;
}

type ScheduleFrame = (callback: () => void) => void;
type FlushHandler = (payload: RefreshPayload) => void;

export class RefreshScheduler {
  private queued = false;
  private pendingPayload: RefreshPayload = {};
  private scheduleFrame: ScheduleFrame;
  private onFlush: FlushHandler;

  constructor(scheduleFrame: ScheduleFrame, onFlush: FlushHandler) {
    this.scheduleFrame = scheduleFrame;
    this.onFlush = onFlush;
  }

  enqueue(viewportTopLine?: number, options?: RefreshOptions): void {
    this.pendingPayload = { viewportTopLine, options };

    if (this.queued) {
      return;
    }

    this.queued = true;
    this.scheduleFrame(() => {
      this.queued = false;
      const payload = this.pendingPayload;
      this.pendingPayload = {};
      this.onFlush(payload);
    });
  }
}
