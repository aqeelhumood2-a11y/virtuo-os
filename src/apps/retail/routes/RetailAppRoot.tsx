import { cookies } from "next/headers";

import { listBranches, listItems, requireCompanyMembership } from "@/core";
import { CSRF_COOKIE_NAME } from "@/core/auth/constants";

import { getSaleDetail, listPendingSales, listSaleHistory } from "../application/sale.service";
import { ItemBrowser } from "../components/ItemBrowser";
import { SaleHistory } from "../components/SaleHistory";
import { SalePanel } from "../components/SalePanel";

// The single dispatch point the Next.js route layer's routeKey -> Component
// map (app-roots.ts) points "retail" at -- same mechanism as Restaurant's
// RestaurantAppRoot (Phase 3): handles its own internal sections via the
// slug array the dynamic mount route already passes through.
export async function RetailAppRoot({ companyId, slug }: { companyId: string; slug?: string[] }) {
  await requireCompanyMembership(companyId);
  const cookieStore = await cookies();
  const csrfToken = cookieStore.get(CSRF_COOKIE_NAME)?.value ?? "";

  const [section, param] = slug ?? [];
  const branches = await listBranches(companyId);
  // Scoped to the first available branch -- most companies have exactly
  // one (1C's onboarding default); a branch switcher for history/pending
  // sales beyond that is a documented simplification for this phase, not a
  // Core limitation (listOrdersForBranch already takes any branchId).
  const defaultBranchId = branches[0]?.id ?? "";

  if (section === "history") {
    const sales = await listSaleHistory(companyId, defaultBranchId);
    return <SaleHistory companyId={companyId} sales={sales} />;
  }

  if (section === "sale" && param) {
    const detail = await getSaleDetail(companyId, param);
    if (!detail) {
      return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-8 text-center">
          <h1 className="text-lg font-semibold text-neutral-900">Sale not found</h1>
        </main>
      );
    }
    const items = await listItems(companyId);
    return (
      <SalePanel
        companyId={companyId}
        csrfToken={csrfToken}
        order={detail.order}
        lines={detail.lines}
        items={items}
      />
    );
  }

  const [items, pendingSales] = await Promise.all([
    listItems(companyId),
    defaultBranchId ? listPendingSales(companyId, defaultBranchId) : Promise.resolve([]),
  ]);

  return (
    <ItemBrowser
      companyId={companyId}
      csrfToken={csrfToken}
      branches={branches}
      items={items}
      pendingSales={pendingSales}
    />
  );
}
