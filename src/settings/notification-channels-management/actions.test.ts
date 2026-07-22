import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const csrfTokensMatchMock = vi.fn();
const connectWhatsAppChannelMock = vi.fn();
const disconnectWhatsAppChannelMock = vi.fn();
const syncWhatsAppNotificationsMock = vi.fn();

let csrfCookieValue: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "csrf_token" && csrfCookieValue ? { value: csrfCookieValue } : undefined),
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/core/auth/csrf", () => ({
  csrfTokensMatch: (a: string, b: string) => csrfTokensMatchMock(a, b),
}));

vi.mock("@/core", () => ({
  WhatsAppSendError: class WhatsAppSendError extends Error {},
}));

vi.mock("@/platform", () => ({
  WhatsAppChannelNotConnectedError: class WhatsAppChannelNotConnectedError extends Error {},
  connectWhatsAppChannel: (...args: unknown[]) => connectWhatsAppChannelMock(...args),
  disconnectWhatsAppChannel: (...args: unknown[]) => disconnectWhatsAppChannelMock(...args),
  syncWhatsAppNotifications: (...args: unknown[]) => syncWhatsAppNotificationsMock(...args),
}));

import { connectWhatsAppAction, disconnectWhatsAppAction, syncWhatsAppAction } from "./actions";

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  csrfCookieValue = "valid-csrf-token";
  csrfTokensMatchMock.mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("connectWhatsAppAction", () => {
  const validForm = () =>
    formData({
      companyId: "company-1",
      phoneNumberId: "123",
      accessToken: "tok",
      toPhoneNumber: "15551234567",
      csrfToken: "valid-csrf-token",
    });

  it("rejects when the CSRF token does not match", async () => {
    csrfTokensMatchMock.mockReturnValue(false);
    const result = await connectWhatsAppAction({}, validForm());

    expect(result.error).toMatch(/session has expired/i);
    expect(connectWhatsAppChannelMock).not.toHaveBeenCalled();
  });

  it("calls connectWhatsAppChannel with the parsed fields", async () => {
    const result = await connectWhatsAppAction({}, validForm());

    expect(connectWhatsAppChannelMock).toHaveBeenCalledWith("company-1", {
      phoneNumberId: "123",
      accessToken: "tok",
      toPhoneNumber: "15551234567",
    });
    expect(result.success).toBeDefined();
  });
});

describe("disconnectWhatsAppAction", () => {
  it("calls disconnectWhatsAppChannel", async () => {
    const result = await disconnectWhatsAppAction({}, formData({ companyId: "company-1", csrfToken: "valid-csrf-token" }));

    expect(disconnectWhatsAppChannelMock).toHaveBeenCalledWith("company-1");
    expect(result.success).toBeDefined();
  });
});

describe("syncWhatsAppAction", () => {
  it("calls syncWhatsAppNotifications and reports the summary", async () => {
    syncWhatsAppNotificationsMock.mockResolvedValue({ syncedAt: "now", messagesSent: 3 });
    const result = await syncWhatsAppAction({}, formData({ companyId: "company-1", csrfToken: "valid-csrf-token" }));

    expect(syncWhatsAppNotificationsMock).toHaveBeenCalledWith("company-1");
    expect(result.success).toMatch(/3 message/);
  });
});
