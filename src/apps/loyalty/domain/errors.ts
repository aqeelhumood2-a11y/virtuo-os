export class MemberNotFoundError extends Error {
  constructor() {
    super("Loyalty member not found.");
    this.name = "MemberNotFoundError";
  }
}

export class OrderNotFoundError extends Error {
  constructor() {
    super("Order not found.");
    this.name = "OrderNotFoundError";
  }
}

// Distinct from a duplicate/idempotent re-attribution (same order, same
// member -- a harmless retry): this is only thrown when an order that's
// already attributed to one member is attributed again to a *different*
// one, which is almost certainly a staff mistake worth surfacing rather
// than silently overwriting.
export class OrderAlreadyAttributedError extends Error {
  constructor() {
    super("This order is already attributed to a different member.");
    this.name = "OrderAlreadyAttributedError";
  }
}
