import { beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(function FakeAnthropic() {
    return { messages: { create: createMock } };
  }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("askClaude", () => {
  it("throws AiAssistantNotConfiguredError when no API key is set", async () => {
    vi.doMock("@/shared/config/server-env", () => ({ serverEnv: {} }));
    const { askClaude, AiAssistantNotConfiguredError } = await import("./llm-client");

    await expect(askClaude("system", "question")).rejects.toThrow(AiAssistantNotConfiguredError);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("calls the Messages API and returns the text block", async () => {
    vi.doMock("@/shared/config/server-env", () => ({ serverEnv: { ANTHROPIC_API_KEY: "test-key" } }));
    createMock.mockResolvedValue({ content: [{ type: "text", text: "The answer is 42." }] });

    const { askClaude } = await import("./llm-client");
    const result = await askClaude("You are a helpful assistant.", "What is the answer?");

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        system: "You are a helpful assistant.",
        messages: [{ role: "user", content: "What is the answer?" }],
      }),
    );
    expect(result).toBe("The answer is 42.");
  });

  it("returns an empty string when no text block is present", async () => {
    vi.doMock("@/shared/config/server-env", () => ({ serverEnv: { ANTHROPIC_API_KEY: "test-key" } }));
    createMock.mockResolvedValue({ content: [] });

    const { askClaude } = await import("./llm-client");
    await expect(askClaude("system", "question")).resolves.toBe("");
  });
});
