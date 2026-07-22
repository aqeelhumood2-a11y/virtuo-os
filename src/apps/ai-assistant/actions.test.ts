import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const csrfTokensMatchMock = vi.fn();
const requireCompanyMembershipMock = vi.fn();
const answerQuestionMock = vi.fn();

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
  requireCompanyMembership: (...args: unknown[]) => requireCompanyMembershipMock(...args),
}));

vi.mock("./application/llm-client", () => ({
  AiAssistantNotConfiguredError: class AiAssistantNotConfiguredError extends Error {},
}));

vi.mock("./application/query-orchestrator.service", () => ({
  answerQuestion: (...args: unknown[]) => answerQuestionMock(...args),
}));

import { askQuestionAction } from "./actions";

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  csrfCookieValue = "valid-csrf-token";
  csrfTokensMatchMock.mockReturnValue(true);
  requireCompanyMembershipMock.mockResolvedValue({
    session: { uid: "uid-1", email: null, superAdmin: false },
    membership: { uid: "uid-1", role: "Owner", branchIds: [], status: "active" },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("askQuestionAction", () => {
  const validForm = () => formData({ companyId: "company-1", branchId: "branch-1", question: "How much stock do we have?", csrfToken: "valid-csrf-token" });

  it("rejects when the CSRF token does not match", async () => {
    csrfTokensMatchMock.mockReturnValue(false);
    const result = await askQuestionAction({}, validForm());

    expect(result.error).toMatch(/session has expired/i);
    expect(answerQuestionMock).not.toHaveBeenCalled();
  });

  it("rejects an empty question", async () => {
    const result = await askQuestionAction(
      {},
      formData({ companyId: "company-1", branchId: "branch-1", question: "", csrfToken: "valid-csrf-token" }),
    );

    expect(result.error).toBeDefined();
    expect(answerQuestionMock).not.toHaveBeenCalled();
  });

  it("calls answerQuestion with the actor's own uid/role and returns the answer", async () => {
    answerQuestionMock.mockResolvedValue("You have 5 Widgets in stock.");
    const result = await askQuestionAction({}, validForm());

    expect(answerQuestionMock).toHaveBeenCalledWith("company-1", "uid-1", "Owner", "branch-1", "How much stock do we have?");
    expect(result.answer).toBe("You have 5 Widgets in stock.");
  });
});
