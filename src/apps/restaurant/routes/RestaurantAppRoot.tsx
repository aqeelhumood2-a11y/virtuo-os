import { cookies } from "next/headers";

import { listBranches, listItems, requireCompanyMembership } from "@/core";
import { CSRF_COOKIE_NAME } from "@/core/auth/constants";

import { getTicketDetail, listOrderHistory, resumePendingTickets } from "../application/order-ticket.service";
import { MenuBrowser } from "../components/MenuBrowser";
import { OrderHistory } from "../components/OrderHistory";
import { TicketPanel } from "../components/TicketPanel";

// The single dispatch point the Next.js route layer's routeKey -> Component
// map (app-roots.ts) points "restaurant" at. Handles its own internal
// sections via the slug array the dynamic mount route already passes
// through, rather than adding any new Next.js route segments -- see the
// Phase 3 plan's dynamic-routing mechanism.
export async function RestaurantAppRoot({ companyId, slug }: { companyId: string; slug?: string[] }) {
  await requireCompanyMembership(companyId);
  const cookieStore = await cookies();
  const csrfToken = cookieStore.get(CSRF_COOKIE_NAME)?.value ?? "";

  const [section, param] = slug ?? [];

  if (section === "history") {
    const tickets = await listOrderHistory(companyId);
    return <OrderHistory companyId={companyId} tickets={tickets} />;
  }

  if (section === "ticket" && param) {
    const detail = await getTicketDetail(companyId, param);
    if (!detail) {
      return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-8 text-center">
          <h1 className="text-lg font-semibold text-neutral-900">Order not found</h1>
        </main>
      );
    }
    const items = await listItems(companyId);
    return (
      <TicketPanel
        companyId={companyId}
        csrfToken={csrfToken}
        order={detail.order}
        lines={detail.lines}
        meta={detail.meta}
        items={items}
      />
    );
  }

  const [branches, items, pendingTickets] = await Promise.all([
    listBranches(companyId),
    listItems(companyId),
    resumePendingTickets(companyId),
  ]);

  return (
    <MenuBrowser
      companyId={companyId}
      csrfToken={csrfToken}
      branches={branches}
      items={items}
      pendingTickets={pendingTickets}
    />
  );
}
