// Platform's own capability, never added to core/roles-permissions --
// Core must not know licenses/plans exist. See docs/phases/PHASE_2_PLAN.md §8.
export type LicenseCapability = "licenses.view";

export type License = {
  plan: string;
  // Entitlement only -- NOT install state. Actual on/off state lives
  // exclusively in platform/app-installs and platform/connector-connections
  // (companies/{companyId}/apps, companies/{companyId}/connectors). See
  // docs/phases/PHASE_2_PLAN.md §2/§7.
  entitledApps: string[];
  entitledConnectors: string[];
  seats: number;
  renewsAt: string | null;
};
