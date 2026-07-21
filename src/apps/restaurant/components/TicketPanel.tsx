"use client";

import { useActionState } from "react";

import type { InventoryItem, Order, OrderLine } from "@/core";
import { Button, Input } from "@/shared/ui";

import {
  addLineAction,
  completeOrderAction,
  removeLineAction,
  updateQuantityAction,
  voidOrderAction,
  type RestaurantActionFormState,
} from "../actions";
import type { RestaurantOrderMeta } from "../domain/order-meta.types";

const initialState: RestaurantActionFormState = {};

function LineRow({
  csrfToken,
  companyId,
  orderId,
  line,
}: {
  csrfToken: string;
  companyId: string;
  orderId: string;
  line: OrderLine;
}) {
  const [quantityState, quantityAction, quantityPending] = useActionState(updateQuantityAction, initialState);
  const [removeState, removeAction, removePending] = useActionState(removeLineAction, initialState);

  return (
    <div className="flex flex-col gap-1 rounded-md border border-neutral-200 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-neutral-900">
          {line.itemNameSnapshot} &mdash; ${line.unitPrice.toFixed(2)} each
        </span>
        <span className="text-sm font-medium text-neutral-900">${line.lineTotal.toFixed(2)}</span>
      </div>
      <div className="flex items-center gap-2">
        <form action={quantityAction} className="flex items-center gap-2">
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <input type="hidden" name="companyId" value={companyId} />
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="lineId" value={line.id} />
          <Input
            type="number"
            name="quantity"
            min={1}
            defaultValue={line.quantity}
            className="w-20"
          />
          <Button type="submit" variant="secondary" disabled={quantityPending}>
            {quantityPending ? "Updating…" : "Update qty"}
          </Button>
        </form>
        <form action={removeAction}>
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <input type="hidden" name="companyId" value={companyId} />
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="lineId" value={line.id} />
          <Button type="submit" variant="ghost" disabled={removePending}>
            {removePending ? "Removing…" : "Remove"}
          </Button>
        </form>
      </div>
      {quantityState.error ? <p className="text-sm text-red-600">{quantityState.error}</p> : null}
      {removeState.error ? <p className="text-sm text-red-600">{removeState.error}</p> : null}
    </div>
  );
}

function AddItemRow({
  csrfToken,
  companyId,
  orderId,
  item,
}: {
  csrfToken: string;
  companyId: string;
  orderId: string;
  item: InventoryItem;
}) {
  const [state, action, pending] = useActionState(addLineAction, initialState);

  return (
    <form action={action} className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 p-2">
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="itemId" value={item.id} />
      <input type="hidden" name="itemNameSnapshot" value={item.name} />
      <input type="hidden" name="unitPrice" value={item.defaultPrice} />
      <span className="text-sm text-neutral-900">{item.name}</span>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Adding…" : "Add"}
      </Button>
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
    </form>
  );
}

export function TicketPanel({
  companyId,
  csrfToken,
  order,
  lines,
  meta,
  items,
}: {
  companyId: string;
  csrfToken: string;
  order: Order;
  lines: OrderLine[];
  meta: RestaurantOrderMeta | null;
  items: InventoryItem[];
}) {
  const [completeState, completeAction, completePending] = useActionState(completeOrderAction, initialState);
  const [voidState, voidAction, voidPending] = useActionState(voidOrderAction, initialState);

  const isPending = order.status === "pending";

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <h1 className="text-lg font-semibold text-neutral-900">Order {order.id}</h1>
      <p className="text-sm text-neutral-600">
        Status: {order.status}
        {meta ? ` · ${meta.orderType}${meta.tableRef ? ` · ${meta.tableRef}` : ""}` : ""}
      </p>

      <div className="flex flex-col gap-2">
        {lines.map((line) => (
          <LineRow key={line.id} csrfToken={csrfToken} companyId={companyId} orderId={order.id} line={line} />
        ))}
      </div>

      <p className="text-right text-sm font-semibold text-neutral-900">Total: ${order.totals.total.toFixed(2)}</p>

      {isPending ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-neutral-900">Add an item</h2>
          {items.map((item) => (
            <AddItemRow key={item.id} csrfToken={csrfToken} companyId={companyId} orderId={order.id} item={item} />
          ))}
        </div>
      ) : null}

      {isPending ? (
        <div className="flex gap-3">
          <form action={completeAction}>
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <input type="hidden" name="companyId" value={companyId} />
            <input type="hidden" name="orderId" value={order.id} />
            <Button type="submit" disabled={completePending}>
              {completePending ? "Completing…" : "Complete order"}
            </Button>
          </form>
          <form action={voidAction}>
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <input type="hidden" name="companyId" value={companyId} />
            <input type="hidden" name="orderId" value={order.id} />
            <Button type="submit" variant="ghost" disabled={voidPending}>
              {voidPending ? "Voiding…" : "Void order"}
            </Button>
          </form>
        </div>
      ) : null}
      {completeState.error ? <p className="text-sm text-red-600">{completeState.error}</p> : null}
      {voidState.error ? <p className="text-sm text-red-600">{voidState.error}</p> : null}

      <a href={`/${companyId}/apps/restaurant`} className="text-sm text-brand-600 hover:underline">
        Back to menu
      </a>
    </main>
  );
}
