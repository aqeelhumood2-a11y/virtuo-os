// Phase 7: Next.js's documented observability hook (stable since v15,
// see node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md).
// onRequestError is called by the Next.js server itself for any uncaught
// error surfaced while rendering a Server Component, handling a Route
// Handler, or running a Server Action -- this is the one place that
// catches all three without wrapping every individual call site by hand.
import type { Instrumentation } from "next";

import { reportError } from "@/shared/observability/error-reporter";

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  reportError(error, {
    routePath: context.routePath,
    routeType: context.routeType,
    method: request.method,
  });
};
