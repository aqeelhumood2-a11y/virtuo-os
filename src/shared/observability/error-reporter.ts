import { logger } from "./logger";

export type ReportedErrorContext = {
  routePath?: string;
  routeType?: string;
  method?: string;
  digest?: string;
  [key: string]: unknown;
};

export type ErrorSink = (error: unknown, context: ReportedErrorContext) => void;

// The one sink that's always active: every reported error becomes a
// structured log line, which is real, working observability today -- both
// Vercel's own function logs and any external log drain/alerting rule
// pointed at stdout/stderr already receive these with no further setup.
const structuredLogSink: ErrorSink = (error, context) => {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  logger.error(message, { ...context, stack });
};

let extraSinks: ErrorSink[] = [];

// The intentional extension point for a real third-party error-tracking
// service (Sentry, Datadog, Bugsnag, etc.): none is wired in here, because
// doing so would mean either adding an SDK this codebase cannot exercise
// end-to-end (no account/DSN exists to verify delivery against) or
// hand-rolling that service's ingestion wire format with no way to confirm
// it's correct -- both would risk shipping something that looks complete
// but silently fails in production. Register a real sink here once an
// account/credential exists; until then, the structured log sink above is
// this app's genuine, working error-tracking story. See
// docs/phases/PHASE_7_PLAN.md for the full reasoning.
export function registerErrorSink(sink: ErrorSink): void {
  extraSinks = [...extraSinks, sink];
}

// Exposed for tests only, to reset state registerErrorSink accumulates
// across test files sharing this module.
export function __resetErrorSinksForTests(): void {
  extraSinks = [];
}

export function reportError(error: unknown, context: ReportedErrorContext = {}): void {
  structuredLogSink(error, context);
  for (const sink of extraSinks) {
    try {
      sink(error, context);
    } catch (sinkError) {
      // A broken sink must never itself crash error reporting -- the
      // structured log above has already captured the original error by
      // this point regardless of what happens here.
      logger.warn("error-reporter: a registered sink threw", {
        sinkError: sinkError instanceof Error ? sinkError.message : String(sinkError),
      });
    }
  }
}
