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

// Compile-time registration of every known App -- empty until Phase 3
// registers the first real vertical (see docs/ROADMAP.md's Phase 3). Once
// a real App exists, this file imports its manifest.ts and calls
// registerApp() here -- the one narrow, intentional exception to App
// Registry's otherwise zero-dependency status (see
// docs/phases/PHASE_2_PLAN.md §5): a registration mechanism inherently
// references what it registers, the same shape connectors/registry.ts
// already uses for the one stub connector.
