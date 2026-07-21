// Platform's own capability, never added to core/roles-permissions -- see
// docs/phases/PHASE_2_PLAN.md §8.
export type AppInstallCapability = "apps.view" | "apps.install";

// Colocated with the module that produces these actions, mirroring
// CompanyAuditAction/InventoryAuditAction's decentralization (Phase 1G
// hardening) -- unioned into core/audit-logs' generic writeAuditInTransaction
// call via an explicit type argument, never by editing core/audit-logs
// itself. See docs/phases/PHASE_2_PLAN.md §2/§7.
export type AppInstallAuditAction = "app.installed" | "app.uninstalled" | "app.forceToggled";

// companies/{companyId}/apps/{appId} -- the sole source of truth for
// install state (entitlement lives separately in platform/licenses; the
// two are never duplicated). See docs/phases/PHASE_2_PLAN.md §2/§7.
export type InstalledApp = {
  appId: string;
  enabled: boolean;
  installedAt?: string;
  config?: Record<string, unknown>;
};
