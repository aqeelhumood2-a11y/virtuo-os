import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetErrorSinksForTests, registerErrorSink, reportError } from "./error-reporter";

describe("reportError", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    __resetErrorSinksForTests();
  });

  it("always logs a structured entry, including the error's stack", () => {
    reportError(new Error("boom"), { routePath: "/api/webhooks/shopify" });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(entry.level).toBe("error");
    expect(entry.message).toBe("boom");
    expect(entry.context.routePath).toBe("/api/webhooks/shopify");
    expect(typeof entry.context.stack).toBe("string");
  });

  it("stringifies a non-Error thrown value rather than crashing", () => {
    reportError("just a string");

    const entry = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(entry.message).toBe("just a string");
  });

  it("forwards every reported error to a registered sink", () => {
    const sink = vi.fn();
    registerErrorSink(sink);

    const error = new Error("boom");
    reportError(error, { routePath: "/x" });

    expect(sink).toHaveBeenCalledWith(error, { routePath: "/x" });
  });

  it("does not let a throwing sink stop other sinks or the structured log", () => {
    const brokenSink = vi.fn(() => {
      throw new Error("sink is broken");
    });
    const healthySink = vi.fn();
    registerErrorSink(brokenSink);
    registerErrorSink(healthySink);

    expect(() => reportError(new Error("boom"))).not.toThrow();
    expect(healthySink).toHaveBeenCalled();
    // Once for the original error, once for the broken sink's own warning.
    expect(errorSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
