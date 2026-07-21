import type { OrderStatus } from "./types";

export class OrderNotFoundError extends Error {
  constructor() {
    super("Order not found.");
    this.name = "OrderNotFoundError";
  }
}

// The idempotency guard: completing (or voiding) an order re-reads its
// current status inside the transaction and throws this if it isn't in a
// state the requested transition allows -- retrying an already-completed
// order is a safe no-op-with-error, never a second stock deduction.
export class InvalidOrderTransitionError extends Error {
  constructor(from: OrderStatus, to: OrderStatus) {
    super(`Cannot transition an order from '${from}' to '${to}'.`);
    this.name = "InvalidOrderTransitionError";
  }
}

// Distinct from InvalidOrderTransitionError -- adding a line isn't a status
// transition, it's an edit that's only ever valid while the order hasn't
// been finalized yet.
export class OrderNotEditableError extends Error {
  constructor() {
    super("Only a pending order can be edited.");
    this.name = "OrderNotEditableError";
  }
}

export class OrderLineNotFoundError extends Error {
  constructor() {
    super("Order line not found.");
    this.name = "OrderLineNotFoundError";
  }
}
