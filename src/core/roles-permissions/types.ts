// The canonical role vocabulary -- companies/types.ts's MembershipRole is
// an alias of this, not the other way around, so this module never
// imports from companies (avoids a types.ts <-> types.ts cycle).
export type Role = "Owner" | "Manager" | "Supervisor" | "Employee";

export type Capability =
  | "company.view"
  | "company.update"
  | "company.suspend"
  | "branch.view"
  | "membership.view"
  | "membership.updateRole"
  | "membership.deactivate"
  | "inventory.view"
  | "inventory.write"
  | "orders.view"
  | "orders.create"
  | "orders.complete"
  | "orders.void";
