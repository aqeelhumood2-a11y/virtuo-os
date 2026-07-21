// Shared by every branch-scoped module (inventory-engine, order-engine, ...)
// that layers hasBranchAccess() on top of a capability check -- lives here,
// next to hasBranchAccess() itself, rather than being owned by whichever
// engine happened to need it first.
export class BranchAccessDeniedError extends Error {
  constructor() {
    super("You do not have access to this branch.");
    this.name = "BranchAccessDeniedError";
  }
}
