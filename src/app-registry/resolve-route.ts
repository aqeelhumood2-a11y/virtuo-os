import { getAppManifest } from "./registry";
import type { AppManifest } from "./app-manifest.types";

// Pure -- takes install status as an input rather than looking it up
// itself, so App Registry never touches Firestore, Core, or Platform. The
// caller (the dynamic App-mount route) is responsible for checking install
// state via platform/app-installs first. This is what keeps App Registry a
// catalog, not an application manager -- see docs/phases/PHASE_2_PLAN.md §5.
export function resolveAppRoute(appId: string, isInstalled: boolean): AppManifest | null {
  if (!isInstalled) return null;
  return getAppManifest(appId);
}
