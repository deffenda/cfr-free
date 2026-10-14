/** Log verbosity levels, ordered. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Structured, machine-readable fields attached to a log record. */
export type LogFields = Record<string, unknown>;

/** Minimal logger interface; implementations must never write to stdout. */
export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

/** Writable target for log lines (stderr by default: stdout is JSON-RPC). */
export interface LogStream {
  write(chunk: string): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Create a JSON-lines logger.
 *
 * @param level Minimum level to emit.
 * @param stream Destination; defaults to `process.stderr` because stdout is
 *   reserved for the MCP stdio protocol.
 */
export function createLogger(level: LogLevel = 'info', stream: LogStream = process.stderr): Logger {
  const threshold = LEVEL_ORDER[level];

  const emit = (recordLevel: LogLevel, message: string, fields?: LogFields): void => {
    if (LEVEL_ORDER[recordLevel] < threshold) return;
    const record: LogFields = {
      time: new Date().toISOString(),
      level: recordLevel,
      message,
      ...fields,
    };
    let line: string | undefined;
    try {
      line = JSON.stringify(record);
    } catch {
      line = JSON.stringify({
        time: new Date().toISOString(),
        level: recordLevel,
        message,
        fieldsError: 'unserializable',
      });
    }
    stream.write(`${line ?? '{}'}\n`);
  };

  return {
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
  };
}
