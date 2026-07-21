import { resolveAppRoute } from "@/app-registry";
import { requireCompanyMembership } from "@/core/companies/membership";
import { isAppInstalled } from "@/platform";

export default async function AppMountPage({
  params,
}: {
  params: Promise<{ companyId: string; appId: string; slug?: string[] }>;
}) {
  const { companyId, appId } = await params;
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

  // No real App exists until Phase 3 -- resolveAppRoute() can never return
  // a non-null manifest in Phase 2 (the registry is empty), so this branch
  // is unreachable today. Kept so the mount mechanism is fully built and
  // tested ahead of a real App. See docs/phases/PHASE_2_PLAN.md §5.
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-lg font-semibold text-neutral-900">{manifest.displayName}</h1>
    </main>
  );
}
