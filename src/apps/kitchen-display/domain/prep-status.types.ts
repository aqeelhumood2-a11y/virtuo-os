// A Kitchen-Display-only concept layered on top of Core's own OrderStatus
// (pending|completed|voided), never a replacement for it -- Core's own
// status remains the sole source of truth for the business transaction.
// See docs/phases/PHASE_6_PLAN.md §3.
export type PrepStage = "queued" | "preparing" | "ready";

export type PrepStatus = {
  orderId: string;
  branchId: string;
  stage: PrepStage;
  updatedBy: string;
};

export function nextStage(current: PrepStage): PrepStage | null {
  if (current === "queued") return "preparing";
  if (current === "preparing") return "ready";
  return null;
}
