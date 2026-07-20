import type { OrderStatus } from "./types";

// The single source of truth for which order-status transitions are valid.
// pending -> completed | voided; completed -> voided; voided is terminal.
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["completed", "voided"],
  completed: ["voided"],
  voided: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
