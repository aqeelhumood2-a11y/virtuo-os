import { restaurantManifest } from "@/apps/restaurant/manifest";
import { retailManifest } from "@/apps/retail/manifest";

import type { AppManifest } from "./app-manifest.types";

const registry = new Map<string, AppManifest>();

export function registerApp(manifest: AppManifest): void {
  registry.set(manifest.id, manifest);
}

export function getRegisteredApps(): AppManifest[] {
  return Array.from(registry.values());
}

export function getAppManifest(appId: string): AppManifest | null {
  return registry.get(appId) ?? null;
}

// Compile-time registration of every known App -- Phase 3 registered the
// first real vertical (Restaurant); Phase 4 adds the second (Retail) here.
// This is the one narrow, intentional exception to App Registry's otherwise
// zero-dependency status (see docs/phases/PHASE_2_PLAN.md §5): a
// registration mechanism inherently references what it registers, the same
// shape connectors/registry.ts already uses for the one stub connector. A
// future App is added the same way: import its manifest.ts, call
// registerApp() here.
registerApp(restaurantManifest);
registerApp(retailManifest);
