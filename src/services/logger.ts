const PREFIX = "[Schreibstube]";

export interface LogSink {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * A tiny leveled logger. `warn`/`error` always reach the console so a
 * user-reported failure leaves a trace; `debug`/`info` are gated behind the
 * user's debug-logging setting to keep the console quiet by default.
 *
 * `isDebugEnabled` is read on every call, so toggling the setting takes effect
 * immediately without recreating the logger.
 */
export function createLogger(isDebugEnabled: () => boolean, sink: LogSink = console): Logger {
  return {
    debug(message, ...args) {
      if (isDebugEnabled()) {
        sink.debug(PREFIX, message, ...args);
      }
    },
    info(message, ...args) {
      if (isDebugEnabled()) {
        sink.info(PREFIX, message, ...args);
      }
    },
    warn(message, ...args) {
      sink.warn(PREFIX, message, ...args);
    },
    error(message, ...args) {
      sink.error(PREFIX, message, ...args);
    }
  };
}

/** A logger that discards everything. Handy as a default in pure services. */
export const NULL_LOGGER: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {}
};
