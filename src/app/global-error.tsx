"use client";

import { useEffect } from "react";

import { reportError } from "@/shared/observability/error-reporter";

// Phase 7: the root-level error boundary (App Router convention -- see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md).
// Catches rendering errors instrumentation.ts's onRequestError cannot see
// (client-side render failures after hydration never reach the server),
// so this is the client-side half of the same reportError() pipeline, not
// a duplicate of it. Must define its own <html>/<body>, since it replaces
// the root layout when active.
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    reportError(error, { digest: error.digest, routeType: "render" });
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
          <div style={{ textAlign: "center" }}>
            <h1 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.5rem" }}>Something went wrong</h1>
            <p style={{ marginBottom: "1rem", color: "#666" }}>
              An unexpected error occurred. The team has been notified.
            </p>
            <button
              type="button"
              onClick={() => unstable_retry()}
              style={{ padding: "0.5rem 1rem", borderRadius: "0.375rem", border: "1px solid #ccc", cursor: "pointer" }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
