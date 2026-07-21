// The contract every installable App must satisfy. App Registry owns only
// this shape, registration, discovery, and pure route resolution -- never
// install state or install business logic (that's platform/app-installs).
// See docs/phases/PHASE_2_PLAN.md §5.
export type AppManifest = {
  id: string;
  displayName: string;
  icon?: string;
  // Identifies which entry in the Next.js route layer's own routeKey ->
  // Component map (src/app/(dashboard)/[companyId]/apps/[appId]/[[...slug]]/
  // app-roots.ts) renders this App's UI. Deliberately a plain string, never
  // a ComponentType/React import -- App Registry must stay UI-independent
  // (docs/phases/PHASE_3_PLAN.md §3/§9); React lives only at the route
  // layer, which is already permitted to depend on everything below it.
  routeKey: string;
};
