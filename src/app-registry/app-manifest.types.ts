// The contract every installable App must satisfy. App Registry owns only
// this shape, registration, discovery, and pure route resolution -- never
// install state or install business logic (that's platform/app-installs).
// See docs/phases/PHASE_2_PLAN.md §5.
export type AppManifest = {
  id: string;
  displayName: string;
  icon?: string;
  // Reserved for a future App to declare its own route tree; no real App
  // exists until Phase 3, so this stays a minimal placeholder shape rather
  // than a speculative full routing type.
  routes?: unknown;
};
