import { cookies } from "next/headers";

import { getRegisteredApps } from "@/app-registry";
import { CSRF_COOKIE_NAME } from "@/core/auth/constants";
import { requireSuperAdmin } from "@/core/roles-permissions";
import { listInstalledApps } from "@/platform";

import { ForceToggleList } from "./ForceToggleList";

export default async function AdminAppsPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  await requireSuperAdmin();

  const cookieStore = await cookies();
  const csrfToken = cookieStore.get(CSRF_COOKIE_NAME)?.value ?? "";

  const apps = getRegisteredApps();
  const installedApps = await listInstalledApps(companyId);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 p-8">
      <h1 className="text-lg font-semibold text-neutral-900">Super Admin: Apps for {companyId}</h1>
      <ForceToggleList
        csrfToken={csrfToken}
        companyId={companyId}
        apps={apps}
        installedAppIds={installedApps.map((app) => app.appId)}
      />
    </main>
  );
}
