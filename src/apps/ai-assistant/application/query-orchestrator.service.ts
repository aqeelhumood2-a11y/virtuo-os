import "server-only";

import { hasCapability, listAuditLogsPage, listItems, listOrdersForBranch, listStockForBranch } from "@/core";
import type { Role } from "@/core";

import { askClaude } from "./llm-client";
import { addQueryLogEntry, listRecentQueryLog } from "./query-log.repository";
import type { QueryLogEntry } from "../domain/ai-assistant.types";

// Bounds every context gather the same "cap the scan cost" way every
// other lazy/on-demand Core read in this codebase does (see Loyalty's
// SYNC_PAGE_SIZE, Phase 5's SYNC_ORDER_BATCH_SIZE). Order/Item have no
// exposed createdAt to sort by (see docs/DATABASE.md's convention of not
// surfacing timestamps from repositories), so "most recent" here means
// "last N as returned," a documented approximation, not a guarantee.
const MAX_ORDERS = 20;
const MAX_ITEMS = 50;
const MAX_AUDIT_ENTRIES = 20;

function buildSystemPrompt(context: {
  orders: { id: string; status: string; total: number }[];
  items: { name: string; sku: string; price: number; quantityOnHand: number | null }[];
  auditEntries: { action: string; targetType: string; targetId: string }[] | null;
}): string {
  const lines: string[] = [
    "You are a read-only reporting assistant for a business-management platform.",
    "Answer the user's question using ONLY the data below. Never invent numbers.",
    "If the data below doesn't answer the question, say so plainly.",
    "",
    "## Recent orders",
    ...context.orders.map((o) => `- ${o.id}: ${o.status}, total $${o.total.toFixed(2)}`),
    "",
    "## Inventory items",
    ...context.items.map(
      (i) => `- ${i.name} (${i.sku}): $${i.price.toFixed(2)}${i.quantityOnHand !== null ? `, ${i.quantityOnHand} on hand` : ""}`,
    ),
  ];

  if (context.auditEntries) {
    lines.push("", "## Recent activity log", ...context.auditEntries.map((e) => `- ${e.action} on ${e.targetType} ${e.targetId}`));
  }

  return lines.join("\n");
}

// Gathers a bounded snapshot of data the ASKING USER is already authorized
// to see -- every read below is one of Core's own already-capability-gated
// functions, called as the real actor, never a raw Firestore query. audit
// log context is included only if the actor already has audit.view
// (checked as a plain boolean, no redirect -- same precedent as Loyalty's
// LoyaltyAppRoot), so a frontline caller simply gets an answer grounded in
// orders/inventory only. The LLM itself never touches Firestore, Core, or
// Platform -- it only ever sees the plain-text context assembled here.
export async function answerQuestion(
  companyId: string,
  actorId: string,
  role: Role,
  branchId: string,
  question: string,
): Promise<string> {
  const [orders, items, stock] = await Promise.all([
    branchId ? listOrdersForBranch(companyId, branchId) : Promise.resolve([]),
    listItems(companyId),
    branchId ? listStockForBranch(companyId, branchId) : Promise.resolve([]),
  ]);

  const stockByItemId = new Map(stock.map((s) => [s.itemId, s.quantityOnHand]));

  let auditEntries: { action: string; targetType: string; targetId: string }[] | null = null;
  if (hasCapability(role, "audit.view")) {
    const page = await listAuditLogsPage(companyId, { limit: MAX_AUDIT_ENTRIES });
    auditEntries = page.items.map((entry) => ({ action: entry.action, targetType: entry.targetType, targetId: entry.targetId }));
  }

  const systemPrompt = buildSystemPrompt({
    orders: orders.slice(-MAX_ORDERS).map((o) => ({ id: o.id, status: o.status, total: o.totals.total })),
    items: items.slice(0, MAX_ITEMS).map((i) => ({
      name: i.name,
      sku: i.sku,
      price: i.defaultPrice,
      quantityOnHand: stockByItemId.get(i.id) ?? null,
    })),
    auditEntries,
  });

  const answer = await askClaude(systemPrompt, question);

  // Best-effort -- a failed log write never blocks returning the answer,
  // same "accountability record, not a correctness dependency" tier as
  // Loyalty's syncCursor.
  await addQueryLogEntry(companyId, question, answer, actorId).catch((error: unknown) => {
    console.error("AI Assistant query log write failed:", error);
  });

  return answer;
}

export async function listRecentQuestions(companyId: string, limit: number): Promise<QueryLogEntry[]> {
  return listRecentQueryLog(companyId, limit);
}
