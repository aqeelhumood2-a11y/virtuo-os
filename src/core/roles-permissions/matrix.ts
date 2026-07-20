import type { Capability, Role } from "./types";

const ALL_CAPABILITIES: Capability[] = [
  "company.view",
  "company.update",
  "company.suspend",
  "branch.view",
  "membership.view",
  "membership.updateRole",
  "membership.deactivate",
  "inventory.view",
  "inventory.write",
];

const VIEW_ONLY: Capability[] = ["company.view", "branch.view", "membership.view", "inventory.view"];

// The single source of truth for "who can do what" (ARCHITECTURE.md §4/§6).
// firestore.rules mirrors the two capabilities it needs to check directly
// (company.update/company.suspend) by hand, since rules can't import this
// file -- see the comment there for how the two are kept in sync.
export const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  Owner: ALL_CAPABILITIES,
  // Everything except assigning roles and suspending the company itself --
  // those two stay Owner-only.
  Manager: ALL_CAPABILITIES.filter(
    (capability) => capability !== "membership.updateRole" && capability !== "company.suspend",
  ),
  Supervisor: VIEW_ONLY,
  Employee: VIEW_ONLY,
};

// Fixed hierarchy per ARCHITECTURE.md §5: SuperAdmin > Owner > Manager >
// Supervisor > Employee. Used only to decide whether one member may act on
// another (e.g. deactivation) -- never to grant capabilities by itself.
const ROLE_RANK: Record<Role, number> = {
  Owner: 4,
  Manager: 3,
  Supervisor: 2,
  Employee: 1,
};

export function outranks(actor: Role, target: Role): boolean {
  return ROLE_RANK[actor] > ROLE_RANK[target];
}
