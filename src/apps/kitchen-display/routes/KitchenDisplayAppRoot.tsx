import { cookies } from "next/headers";

import { listBranches, requireCompanyMembership } from "@/core";
import { CSRF_COOKIE_NAME } from "@/core/auth/constants";

import { listQueueForBranch } from "../application/kitchen-display.service";
import { KitchenBoard } from "../components/KitchenBoard";

// The single dispatch point the Next.js route layer's routeKey -> Component
// map (app-roots.ts) points "kitchen-display" at -- same mechanism as every
// other App's own AppRoot. Scoped to the first available branch, the same
// documented simplification Retail's own RetailAppRoot uses.
export async function KitchenDisplayAppRoot({ companyId }: { companyId: string; slug?: string[] }) {
  await requireCompanyMembership(companyId);
  const cookieStore = await cookies();
  const csrfToken = cookieStore.get(CSRF_COOKIE_NAME)?.value ?? "";

  const branches = await listBranches(companyId);
  const branchId = branches[0]?.id ?? "";

  const queue = branchId ? await listQueueForBranch(companyId, branchId) : [];
  const initialQueue = queue.map((entry) => ({
    orderId: entry.order.id,
    status: entry.order.status,
    total: entry.order.totals.total,
    stage: entry.stage,
  }));

  return <KitchenBoard companyId={companyId} branchId={branchId} csrfToken={csrfToken} initialQueue={initialQueue} />;
}
