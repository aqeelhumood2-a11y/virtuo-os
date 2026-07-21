"use client";

import { useActionState, useState } from "react";

import type { Branch, InventoryItem } from "@/core";
import { Button, Input } from "@/shared/ui";

import { startOrderAction, type RestaurantActionFormState } from "../actions";
import type { RestaurantOrderType } from "../domain/order-meta.types";
import type { Ticket } from "../application/order-ticket.service";

const initialState: RestaurantActionFormState = {};

function MenuItemRow({
  csrfToken,
  companyId,
  branchId,
  orderType,
  tableRef,
  guestCount,
  kitchenNote,
  item,
}: {
  csrfToken: string;
  companyId: string;
  branchId: string;
  orderType: RestaurantOrderType;
  tableRef: string;
  guestCount: string;
  kitchenNote: string;
  item: InventoryItem;
}) {
  // Minted once per row and reused across any retry of this exact
  // submission (double-click, browser retry) -- Core's own idempotency
  // guarantee, not this component, is what turns a repeated draftId into
  // "return the same order" instead of "create a second one".
  const [draftId] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState(startOrderAction, initialState);

  return (
    <form action={action} className="flex flex-col gap-1 rounded-md border border-neutral-200 p-3">
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="branchId" value={branchId} />
      <input type="hidden" name="orderType" value={orderType} />
      <input type="hidden" name="tableRef" value={tableRef} />
      <input type="hidden" name="guestCount" value={guestCount} />
      <input type="hidden" name="kitchenNote" value={kitchenNote} />
      <input type="hidden" name="itemId" value={item.id} />
      <input type="hidden" name="itemNameSnapshot" value={item.name} />
      <input type="hidden" name="unitPrice" value={item.defaultPrice} />
      <input type="hidden" name="draftId" value={draftId} />
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-neutral-900">
          {item.name} &mdash; ${item.defaultPrice.toFixed(2)}
        </span>
        <Button type="submit" disabled={pending || !branchId}>
          {pending ? "Starting…" : "Start order"}
        </Button>
      </div>
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
    </form>
  );
}

export function MenuBrowser({
  companyId,
  csrfToken,
  branches,
  items,
  pendingTickets,
}: {
  companyId: string;
  csrfToken: string;
  branches: Branch[];
  items: InventoryItem[];
  pendingTickets: Ticket[];
}) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [orderType, setOrderType] = useState<RestaurantOrderType>("dineIn");
  const [tableRef, setTableRef] = useState("");
  const [guestCount, setGuestCount] = useState("");
  const [kitchenNote, setKitchenNote] = useState("");

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <h1 className="text-lg font-semibold text-neutral-900">Restaurant</h1>

      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-medium text-neutral-900">
          Branch
          <select
            className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900"
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
          >
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium text-neutral-900">
          Order type
          <select
            className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900"
            value={orderType}
            onChange={(event) => setOrderType(event.target.value as RestaurantOrderType)}
          >
            <option value="dineIn">Dine In</option>
            <option value="takeaway">Takeaway</option>
            <option value="delivery">Delivery</option>
          </select>
        </label>

        {orderType === "dineIn" ? (
          <label className="flex flex-col gap-1.5 text-sm font-medium text-neutral-900">
            Table
            <Input value={tableRef} onChange={(event) => setTableRef(event.target.value)} placeholder="Table 4" />
          </label>
        ) : null}

        <label className="flex flex-col gap-1.5 text-sm font-medium text-neutral-900">
          Guest count (optional)
          <Input
            type="number"
            min={1}
            value={guestCount}
            onChange={(event) => setGuestCount(event.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium text-neutral-900">
          Kitchen note (optional)
          <Input value={kitchenNote} onChange={(event) => setKitchenNote(event.target.value)} />
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-neutral-900">Menu</h2>
        {items.map((item) => (
          <MenuItemRow
            key={item.id}
            csrfToken={csrfToken}
            companyId={companyId}
            branchId={branchId}
            orderType={orderType}
            tableRef={tableRef}
            guestCount={guestCount}
            kitchenNote={kitchenNote}
            item={item}
          />
        ))}
      </div>

      {pendingTickets.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-neutral-900">Resume a pending order</h2>
          {pendingTickets.map((ticket) => (
            <a
              key={ticket.order.id}
              href={`/${companyId}/apps/restaurant/ticket/${ticket.order.id}`}
              className="rounded-md border border-neutral-200 p-3 text-sm text-brand-600 hover:bg-neutral-50"
            >
              {ticket.meta.orderType} &mdash; {ticket.meta.tableRef ?? "no table"} &mdash; $
              {ticket.order.totals.total.toFixed(2)}
            </a>
          ))}
        </div>
      ) : null}

      <a href={`/${companyId}/apps/restaurant/history`} className="text-sm text-brand-600 hover:underline">
        View order history
      </a>
    </main>
  );
}
