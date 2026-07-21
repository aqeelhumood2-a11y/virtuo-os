import type { Ticket } from "../application/order-ticket.service";

export function OrderHistory({ companyId, tickets }: { companyId: string; tickets: Ticket[] }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-8">
      <h1 className="text-lg font-semibold text-neutral-900">Order History</h1>
      <div className="flex flex-col gap-2">
        {tickets.map((ticket) => (
          <a
            key={ticket.order.id}
            href={`/${companyId}/apps/restaurant/ticket/${ticket.order.id}`}
            className="flex items-center justify-between rounded-md border border-neutral-200 p-3 text-sm hover:bg-neutral-50"
          >
            <span className="text-neutral-900">
              {ticket.meta.orderType}
              {ticket.meta.tableRef ? ` · ${ticket.meta.tableRef}` : ""} · {ticket.order.status}
            </span>
            <span className="font-medium text-neutral-900">${ticket.order.totals.total.toFixed(2)}</span>
          </a>
        ))}
        {tickets.length === 0 ? <p className="text-sm text-neutral-600">No orders yet.</p> : null}
      </div>
      <a href={`/${companyId}/apps/restaurant`} className="text-sm text-brand-600 hover:underline">
        Back to menu
      </a>
    </main>
  );
}
