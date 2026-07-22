// Phase 7: a minimal structured logger, not a new dependency -- every field
// (level, message, timestamp, context) is emitted as one line of JSON on
// stdout/stderr, which is exactly what Vercel's log drains and any log
// aggregator (Datadog, Better Stack, CloudWatch, etc.) already know how to
// parse without further configuration. Deliberately not a third-party
// logging library: this project already has zero logging dependencies,
// and a JSON-per-line console.log/console.error is the entire feature
// surface any of those libraries would add on top of, for this project's
// current scale.
export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = Record<string, unknown>;

type LogEntry = {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: LogContext;
};

function write(level: LogLevel, message: string, context?: LogContext): void {
  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(context ? { context } : {}),
  };
  const line = JSON.stringify(entry);
  // warn/error go to stderr so log drains that split streams (Vercel does)
  // route them to the right severity bucket; debug/info stay on stdout.
  if (level === "warn" || level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, context?: LogContext) => write("debug", message, context),
  info: (message: string, context?: LogContext) => write("info", message, context),
  warn: (message: string, context?: LogContext) => write("warn", message, context),
  error: (message: string, context?: LogContext) => write("error", message, context),
};
