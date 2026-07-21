import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const csrfTokensMatchMock = vi.fn();
const connectConnectorMock = vi.fn();
const disconnectConnectorMock = vi.fn();

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

vi.mock("@/platform", async () => {
  const actual = await vi.importActual<typeof import("@/platform")>("@/platform");
  return {
    ...actual,
    connectConnector: (...args: unknown[]) => connectConnectorMock(...args),
    disconnectConnector: (...args: unknown[]) => disconnectConnectorMock(...args),
  };
});

import { ConnectorNotEntitledError, ConnectorNotRegisteredError } from "@/platform";

import { connectConnectorAction, disconnectConnectorAction } from "./actions";

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

describe("connectConnectorAction", () => {
  const validForm = () => formData({ companyId: "company-1", connectorId: "custom-api", csrfToken: "valid-csrf-token" });

  it("rejects when the CSRF token does not match", async () => {
    csrfTokensMatchMock.mockReturnValue(false);
    const result = await connectConnectorAction(
      {},
      formData({ companyId: "company-1", connectorId: "custom-api", csrfToken: "wrong" }),
    );
    expect(result.error).toMatch(/session has expired/i);
    expect(connectConnectorMock).not.toHaveBeenCalled();
  });

  it("calls connectConnector with the validated companyId/connectorId and an empty config", async () => {
    const result = await connectConnectorAction({}, validForm());

    expect(connectConnectorMock).toHaveBeenCalledWith("company-1", "custom-api", {});
    expect(result.success).toBeDefined();
  });

  it("maps ConnectorNotEntitledError to a clear, non-technical message", async () => {
    connectConnectorMock.mockRejectedValue(new ConnectorNotEntitledError("custom-api"));
    const result = await connectConnectorAction({}, validForm());

    expect(result.error).toMatch(/plan doesn't include/i);
  });

  it("maps ConnectorNotRegisteredError to a clear, non-technical message", async () => {
    connectConnectorMock.mockRejectedValue(new ConnectorNotRegisteredError("ghost"));
    const result = await connectConnectorAction({}, validForm());

    expect(result.error).toMatch(/doesn't exist/i);
  });
});

describe("disconnectConnectorAction", () => {
  const validForm = () => formData({ companyId: "company-1", connectorId: "custom-api", csrfToken: "valid-csrf-token" });

  it("rejects when the CSRF token does not match", async () => {
    csrfTokensMatchMock.mockReturnValue(false);
    const result = await disconnectConnectorAction(
      {},
      formData({ companyId: "company-1", connectorId: "custom-api", csrfToken: "wrong" }),
    );
    expect(result.error).toMatch(/session has expired/i);
    expect(disconnectConnectorMock).not.toHaveBeenCalled();
  });

  it("calls disconnectConnector with the validated companyId/connectorId", async () => {
    const result = await disconnectConnectorAction({}, validForm());

    expect(disconnectConnectorMock).toHaveBeenCalledWith("company-1", "custom-api");
    expect(result.success).toBeDefined();
  });
});
