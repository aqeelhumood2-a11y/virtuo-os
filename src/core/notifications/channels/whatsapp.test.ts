import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendWhatsAppMessage, verifyWhatsAppCredential, WhatsAppSendError } from "./whatsapp";

const fetchMock = vi.fn();
const config = { phoneNumberId: "1234567890", accessToken: "token-abc", toPhoneNumber: "15551234567" };

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

describe("sendWhatsAppMessage", () => {
  it("posts a text message to the Cloud API", async () => {
    fetchMock.mockResolvedValue({ ok: true });

    await sendWhatsAppMessage(config, "Order voided by Jane");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://graph.facebook.com/v20.0/1234567890/messages",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer token-abc", "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: "15551234567",
          type: "text",
          text: { body: "Order voided by Jane" },
        }),
      }),
    );
  });

  it("throws WhatsAppSendError when the API rejects the request", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized" });

    await expect(sendWhatsAppMessage(config, "hi")).rejects.toThrow(WhatsAppSendError);
  });

  it("throws WhatsAppSendError on a network failure", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(sendWhatsAppMessage(config, "hi")).rejects.toThrow(WhatsAppSendError);
  });
});

describe("verifyWhatsAppCredential", () => {
  it("pings the phone number metadata endpoint", async () => {
    fetchMock.mockResolvedValue({ ok: true });

    await verifyWhatsAppCredential("1234567890", "token-abc");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://graph.facebook.com/v20.0/1234567890",
      expect.objectContaining({ headers: { Authorization: "Bearer token-abc" } }),
    );
  });

  it("throws WhatsAppSendError when verification fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized" });

    await expect(verifyWhatsAppCredential("1234567890", "bad")).rejects.toThrow(WhatsAppSendError);
  });
});
