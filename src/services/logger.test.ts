import { describe, expect, it, vi } from "vitest";
import { createLogger, type LogSink } from "./logger";

function fakeSink(): LogSink & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = { debug: [], info: [], warn: [], error: [] };
  return {
    calls,
    debug: (...args) => calls.debug.push(args),
    info: (...args) => calls.info.push(args),
    warn: (...args) => calls.warn.push(args),
    error: (...args) => calls.error.push(args)
  };
}

describe("createLogger", () => {
  it("suppresses debug/info when debug logging is disabled", () => {
    const sink = fakeSink();
    const log = createLogger(() => false, sink);

    log.debug("hidden");
    log.info("hidden");

    expect(sink.calls.debug).toHaveLength(0);
    expect(sink.calls.info).toHaveLength(0);
  });

  it("emits debug/info when debug logging is enabled", () => {
    const sink = fakeSink();
    const log = createLogger(() => true, sink);

    log.debug("shown", 1);
    log.info("shown");

    expect(sink.calls.debug).toHaveLength(1);
    expect(sink.calls.debug[0]).toEqual(["[Schreibstube]", "shown", 1]);
    expect(sink.calls.info).toHaveLength(1);
  });

  it("always emits warn and error regardless of the flag", () => {
    const sink = fakeSink();
    const log = createLogger(() => false, sink);

    log.warn("warn");
    log.error("boom", new Error("x"));

    expect(sink.calls.warn).toHaveLength(1);
    expect(sink.calls.error).toHaveLength(1);
    expect(sink.calls.error[0][1]).toBe("boom");
  });

  it("re-reads the flag on every call so toggling takes effect immediately", () => {
    const sink = fakeSink();
    const enabled = vi.fn(() => false);
    const log = createLogger(enabled, sink);

    log.debug("first");
    enabled.mockReturnValue(true);
    log.debug("second");

    expect(sink.calls.debug).toHaveLength(1);
    expect(sink.calls.debug[0]).toEqual(["[Schreibstube]", "second"]);
  });
});
