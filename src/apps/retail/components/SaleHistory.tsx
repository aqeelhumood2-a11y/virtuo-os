import type { Order } from "@/core";

export function SaleHistory({ companyId, sales }: { companyId: string; sales: Order[] }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-8">
      <h1 className="text-lg font-semibold text-neutral-900">Sale History</h1>
      <div className="flex flex-col gap-2">
        {sales.map((sale) => (
          <a
            key={sale.id}
            href={`/${companyId}/apps/retail/sale/${sale.id}`}
            className="flex items-center justify-between rounded-md border border-neutral-200 p-3 text-sm hover:bg-neutral-50"
          >
            <span className="text-neutral-900">{sale.status}</span>
            <span className="font-medium text-neutral-900">${sale.totals.total.toFixed(2)}</span>
          </a>
        ))}
        {sales.length === 0 ? <p className="text-sm text-neutral-600">No sales yet.</p> : null}
      </div>
      <a href={`/${companyId}/apps/retail`} className="text-sm text-brand-600 hover:underline">
        Back to items
      </a>
    </main>
  );
}
