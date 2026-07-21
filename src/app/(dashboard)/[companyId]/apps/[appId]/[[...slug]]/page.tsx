import { resolveAppRoute } from "@/app-registry";
import { requireCompanyMembership } from "@/core/companies/membership";
import { isAppInstalled } from "@/platform";

import { APP_ROOT_COMPONENTS } from "./app-roots";

export default async function AppMountPage({
  params,
}: {
  params: Promise<{ companyId: string; appId: string; slug?: string[] }>;
}) {
  const { companyId, appId, slug } = await params;
  await requireCompanyMembership(companyId);

  const installed = await isAppInstalled(companyId, appId);
  const manifest = resolveAppRoute(appId, installed);

  if (!manifest) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-8 text-center">
        <h1 className="text-lg font-semibold text-neutral-900">App not installed</h1>
        <p className="text-sm text-neutral-600">
          &ldquo;{appId}&rdquo; isn&apos;t installed for this company yet.
        </p>
      </main>
    );
  }

  // App Registry only ever hands back a routeKey (plain data, see
  // app-manifest.types.ts) -- the lookup into a real React component
  // happens only here, at the route layer, via app-roots.ts's own map.
  const Component = APP_ROOT_COMPONENTS[manifest.routeKey];
  if (!Component) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-8 text-center">
        <h1 className="text-lg font-semibold text-neutral-900">{manifest.displayName}</h1>
        <p className="text-sm text-neutral-600">This App has no UI mounted yet.</p>
      </main>
    );
  }

  return <Component companyId={companyId} slug={slug} />;
}
