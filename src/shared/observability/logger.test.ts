import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "./logger";

describe("logger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("writes debug/info as one JSON line to console.log", () => {
    logger.info("something happened", { companyId: "company-1" });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
    const entry = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(entry).toMatchObject({ level: "info", message: "something happened", context: { companyId: "company-1" } });
    expect(typeof entry.timestamp).toBe("string");
  });

  it("writes warn/error to console.error, not console.log", () => {
    logger.error("something broke");

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
    const entry = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(entry).toMatchObject({ level: "error", message: "something broke" });
  });

  it("omits the context field entirely when none is given", () => {
    logger.debug("no context here");

    const entry = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(entry).not.toHaveProperty("context");
  });
});
