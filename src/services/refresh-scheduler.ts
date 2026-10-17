export interface RefreshPayload {
  /** The top line and the line under the overlay, when an editor has just measured them. */
  edgeLines?: readonly [number, number] | undefined;
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

  enqueue(edgeLines?: readonly [number, number]): void {
    // A refresh asked for without a measurement, in the same frame as one
    // with it, keeps the measurement rather than dropping it.
    this.pendingPayload = { edgeLines: edgeLines ?? this.pendingPayload.edgeLines };

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
