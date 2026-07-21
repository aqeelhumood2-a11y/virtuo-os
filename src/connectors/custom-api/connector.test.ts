import { describe, expect, it } from "vitest";

import { customApiConnector } from "./connector";

describe("customApiConnector", () => {
  it("connect() returns a connected status with no credentialRef", async () => {
    await expect(customApiConnector.connect({})).resolves.toEqual({ status: "connected" });
  });

  it("disconnect() resolves with no error", async () => {
    await expect(customApiConnector.disconnect()).resolves.toBeUndefined();
  });

  it("sync() returns a plain ISO timestamp", async () => {
    const result = await customApiConnector.sync();
    expect(result.syncedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("onWebhook() returns a plain ISO timestamp regardless of payload", async () => {
    const result = await customApiConnector.onWebhook({ anything: "goes" });
    expect(result.receivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
