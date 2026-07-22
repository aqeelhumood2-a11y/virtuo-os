// @vitest-environment node
//
// Pinned to node for the same reason as inventory-engine's
// stock.emulator.test.ts (see docs/phases/PHASE_1E_PLAN.md §10).
import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const IS_EMULATOR = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

const requireSessionMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const askClaudeMock = vi.fn();

// The LLM call is the one external boundary this suite never crosses for
// real (no live Anthropic API call in CI) -- every Core read and Firestore
// write below is real. See Phase 5's connector-connection.sync.emulator.test.ts
// for the same "fake only the one non-Firestore boundary" precedent.
vi.mock("./llm-client", () => ({
  askClaude: (...args: unknown[]) => askClaudeMock(...args),
}));

vi.mock("@/core/auth/session", () => ({
  requireSession: () => requireSessionMock(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

// Seeds the company with an Owner (createItem requires inventory.write,
// which Employee lacks) and, if a distinct askerUid/askerRole is given, a
// second membership for whoever will actually call answerQuestion --
// createItem() is used instead of a raw Firestore write specifically so a
// genuine inventory.itemCreated audit entry exists to assert against.
// Returns the real Core-assigned itemId.
async function seedCompanyItemAndStock(
  companyId: string,
  ownerUid: string,
  branchId: string,
  asker?: { uid: string; role: string },
): Promise<string> {
  const { adminDb } = await import("@/lib/firebase/admin");
  await adminDb.collection("companies").doc(companyId).set({ name: "Acme", ownerId: ownerUid, status: "active" });
  await adminDb
    .collection("companies")
    .doc(companyId)
    .collection("memberships")
    .doc(ownerUid)
    .set({ uid: ownerUid, role: "Owner", branchIds: [], status: "active" });

  requireSessionMock.mockResolvedValue({ uid: ownerUid, email: null, superAdmin: false });
  const { createItem } = await import("@/core/inventory-engine");
  const item = await createItem(companyId, { sku: "SKU-1", name: "Widget", unit: "each", category: "general", defaultPrice: 9.99 });

  await adminDb
    .collection("companies")
    .doc(companyId)
    .collection("stock")
    .doc(`${branchId}_${item.id}`)
    .set({ branchId, itemId: item.id, quantityOnHand: 7, reorderPoint: 0 });

  if (asker) {
    await adminDb
      .collection("companies")
      .doc(companyId)
      .collection("memberships")
      .doc(asker.uid)
      .set({ uid: asker.uid, role: asker.role, branchIds: [], status: "active" });
  }

  return item.id;
}

describe.skipIf(!IS_EMULATOR)("ai-assistant query orchestration (Firestore Emulator)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("grounds the LLM in real Core stock data and records a real queryLog entry", async () => {
    const companyId = `company-${randomUUID()}`;
    const ownerUid = `uid-${randomUUID()}`;
    const employeeUid = `uid-${randomUUID()}`;
    await seedCompanyItemAndStock(companyId, ownerUid, "branch-1", { uid: employeeUid, role: "Employee" });
    requireSessionMock.mockResolvedValue({ uid: employeeUid, email: null, superAdmin: false });
    askClaudeMock.mockResolvedValue("You have 7 Widgets in stock.");

    const { answerQuestion, listRecentQuestions } = await import("./query-orchestrator.service");
    const answer = await answerQuestion(companyId, employeeUid, "Employee", "branch-1", "How much Widget stock do we have?");

    expect(answer).toBe("You have 7 Widgets in stock.");
    const [systemPrompt] = askClaudeMock.mock.calls[0];
    expect(systemPrompt).toContain("Widget");
    expect(systemPrompt).toContain("7 on hand");
    expect(systemPrompt).not.toContain("Recent activity log");

    const logged = await listRecentQuestions(companyId, 10);
    expect(logged).toEqual([
      expect.objectContaining({
        question: "How much Widget stock do we have?",
        answer: "You have 7 Widgets in stock.",
        actorId: employeeUid,
      }),
    ]);
  }, 20000);

  it("includes real audit log context only for a caller with audit.view", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    await seedCompanyItemAndStock(companyId, uid, "branch-1");
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });
    askClaudeMock.mockResolvedValue("Recent activity looks normal.");

    const { answerQuestion } = await import("./query-orchestrator.service");
    await answerQuestion(companyId, uid, "Owner", "branch-1", "What happened recently?");

    const [systemPrompt] = askClaudeMock.mock.calls[0];
    expect(systemPrompt).toContain("Recent activity log");
    expect(systemPrompt).toContain("inventory.itemCreated");
  }, 20000);
});
