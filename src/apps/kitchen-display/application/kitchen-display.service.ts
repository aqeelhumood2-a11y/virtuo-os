import "server-only";

import { getOrder, listOrdersForBranch } from "@/core";
import type { Order } from "@/core";

import { getPrepStatus, listPrepStatusForBranch, setPrepStage } from "./prep-status.repository";
import type { PrepStage } from "../domain/prep-status.types";

export class OrderNotFoundError extends Error {
  constructor() {
    super("Order not found.");
    this.name = "OrderNotFoundError";
  }
}

export type QueueEntry = { order: Order; stage: PrepStage };

// Voided orders never show on the board; a completed order that has no
// prep-status doc yet defaults to "queued" -- the same "no doc yet means
// the initial state" idiom every App-owned collection in this codebase
// uses (e.g. Loyalty's ledger idempotency guard).
export async function listQueueForBranch(companyId: string, branchId: string): Promise<QueueEntry[]> {
  const [orders, statuses] = await Promise.all([
    listOrdersForBranch(companyId, branchId),
    listPrepStatusForBranch(companyId, branchId),
  ]);
  const stageByOrderId = new Map(statuses.map((status) => [status.orderId, status.stage]));

  return orders
    .filter((order) => order.status !== "voided")
    .map((order) => ({ order, stage: stageByOrderId.get(order.id) ?? "queued" }));
}

// Re-derives the order's own branchId from Core (rather than trusting a
// client-submitted one) so this reuses Core's own getOrder branch-access
// enforcement -- the same "capability alone isn't enough, branch access is
// re-checked" pattern every branch-scoped Core read already applies. No new
// Core capability: any FRONTLINE role (Employee/Supervisor) already has
// orders.view.
export async function advanceStage(companyId: string, orderId: string, stage: PrepStage, actorId: string): Promise<void> {
  const order = await getOrder(companyId, orderId);
  if (!order) throw new OrderNotFoundError();

  await setPrepStage(companyId, orderId, order.branchId, stage, actorId);
}

export async function getStageForOrder(companyId: string, orderId: string): Promise<PrepStage> {
  const status = await getPrepStatus(companyId, orderId);
  return status?.stage ?? "queued";
}
