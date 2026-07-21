import { cookies } from "next/headers";

import { getRegisteredApps } from "@/app-registry";
import { CSRF_COOKIE_NAME } from "@/core/auth/constants";
import { requireCompanyMembership } from "@/core/companies/membership";
import { hasPlatformCapability, listInstalledApps } from "@/platform";

import { AppsList } from "./AppsList";

// Not a Next.js route file despite the name -- a plain composable section
// the real route (src/app/(dashboard)/[companyId]/settings/[[...slug]]/
// page.tsx) renders for the "apps" section. Named page.tsx to match the
// approved Phase 2 folder structure (docs/phases/PHASE_2_PLAN.md §6/§14).
export async function AppsManagementSection({ companyId }: { companyId: string }) {
  const { membership } = await requireCompanyMembership(companyId);

  const cookieStore = await cookies();
  const csrfToken = cookieStore.get(CSRF_COOKIE_NAME)?.value ?? "";

  const apps = getRegisteredApps();
  const installedApps = await listInstalledApps(companyId);

  return (
    <AppsList
      csrfToken={csrfToken}
      companyId={companyId}
      apps={apps}
      installedAppIds={installedApps.map((app) => app.appId)}
      canInstall={hasPlatformCapability(membership.role, "apps.install")}
    />
  );
}
