import { beforeEach, describe, expect, it, vi } from "vitest";

const hasCapabilityMock = vi.fn();
const listAuditLogsPageMock = vi.fn();
const listItemsMock = vi.fn();
const listOrdersForBranchMock = vi.fn();
const listStockForBranchMock = vi.fn();
const askClaudeMock = vi.fn();
const addQueryLogEntryMock = vi.fn();
const listRecentQueryLogMock = vi.fn();

vi.mock("@/core", () => ({
  hasCapability: (...args: unknown[]) => hasCapabilityMock(...args),
  listAuditLogsPage: (...args: unknown[]) => listAuditLogsPageMock(...args),
  listItems: (...args: unknown[]) => listItemsMock(...args),
  listOrdersForBranch: (...args: unknown[]) => listOrdersForBranchMock(...args),
  listStockForBranch: (...args: unknown[]) => listStockForBranchMock(...args),
}));

vi.mock("./llm-client", () => ({
  askClaude: (...args: unknown[]) => askClaudeMock(...args),
}));

vi.mock("./query-log.repository", () => ({
  addQueryLogEntry: (...args: unknown[]) => addQueryLogEntryMock(...args),
  listRecentQueryLog: (...args: unknown[]) => listRecentQueryLogMock(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  listOrdersForBranchMock.mockResolvedValue([{ id: "order-1", branchId: "branch-1", appId: "retail", status: "completed", totals: { total: 10 } }]);
  listItemsMock.mockResolvedValue([{ id: "item-1", sku: "SKU-1", name: "Widget", unit: "each", category: "general", defaultPrice: 9.99, isActive: true }]);
  listStockForBranchMock.mockResolvedValue([{ id: "branch-1_item-1", branchId: "branch-1", itemId: "item-1", quantityOnHand: 5, reorderPoint: 0 }]);
  askClaudeMock.mockResolvedValue("You have 5 Widgets in stock.");
  addQueryLogEntryMock.mockResolvedValue(undefined);
});

describe("answerQuestion", () => {
  it("grounds the LLM call in orders/items/stock and logs the exchange", async () => {
    hasCapabilityMock.mockReturnValue(false);
    const { answerQuestion } = await import("./query-orchestrator.service");

    const answer = await answerQuestion("company-1", "uid-1", "Employee", "branch-1", "How much stock of Widget do we have?");

    expect(listOrdersForBranchMock).toHaveBeenCalledWith("company-1", "branch-1");
    expect(listItemsMock).toHaveBeenCalledWith("company-1");
    expect(listStockForBranchMock).toHaveBeenCalledWith("company-1", "branch-1");
    expect(listAuditLogsPageMock).not.toHaveBeenCalled();

    const [systemPrompt, question] = askClaudeMock.mock.calls[0];
    expect(question).toBe("How much stock of Widget do we have?");
    expect(systemPrompt).toContain("Widget");
    expect(systemPrompt).toContain("5 on hand");
    expect(systemPrompt).not.toContain("Recent activity log");

    expect(answer).toBe("You have 5 Widgets in stock.");
    expect(addQueryLogEntryMock).toHaveBeenCalledWith("company-1", "How much stock of Widget do we have?", "You have 5 Widgets in stock.", "uid-1");
  });

  it("includes audit log context only when the actor has audit.view", async () => {
    hasCapabilityMock.mockReturnValue(true);
    listAuditLogsPageMock.mockResolvedValue({
      items: [{ id: "log-1", actorId: "uid-1", action: "order.completed", targetType: "order", targetId: "order-1" }],
      nextCursor: null,
    });
    const { answerQuestion } = await import("./query-orchestrator.service");

    await answerQuestion("company-1", "owner-1", "Owner", "branch-1", "What happened today?");

    expect(listAuditLogsPageMock).toHaveBeenCalledWith("company-1", { limit: 20 });
    const [systemPrompt] = askClaudeMock.mock.calls[0];
    expect(systemPrompt).toContain("Recent activity log");
    expect(systemPrompt).toContain("order.completed");
  });

  it("never blocks returning the answer when the query log write fails", async () => {
    hasCapabilityMock.mockReturnValue(false);
    addQueryLogEntryMock.mockRejectedValue(new Error("write failed"));
    const { answerQuestion } = await import("./query-orchestrator.service");

    await expect(answerQuestion("company-1", "uid-1", "Employee", "branch-1", "Any question?")).resolves.toBe(
      "You have 5 Widgets in stock.",
    );
  });
});

describe("listRecentQuestions", () => {
  it("delegates to the repository", async () => {
    listRecentQueryLogMock.mockResolvedValue([{ id: "log-1", question: "Q", answer: "A", actorId: "uid-1" }]);
    const { listRecentQuestions } = await import("./query-orchestrator.service");

    await expect(listRecentQuestions("company-1", 10)).resolves.toEqual([{ id: "log-1", question: "Q", answer: "A", actorId: "uid-1" }]);
  });
});
