"use client";

import { useActionState, useMemo, useState } from "react";

import type { Branch, InventoryItem, Order } from "@/core";
import { Button } from "@/shared/ui";

import { checkoutAction, type RetailActionFormState } from "../actions";
import type { SaleLineInput } from "../domain/sale.types";

const initialState: RetailActionFormState = {};

type CartLine = SaleLineInput;

export function ItemBrowser({
  companyId,
  csrfToken,
  branches,
  items,
  pendingSales,
}: {
  companyId: string;
  csrfToken: string;
  branches: Branch[];
  items: InventoryItem[];
  pendingSales: Order[];
}) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [cart, setCart] = useState<CartLine[]>([]);
  // Minted once per checkout attempt and reused across any retry of that
  // same submission (double-click, browser retry) -- Core's own idempotency
  // guarantee (Phase 3), not this component, is what turns a repeated
  // draftId into "return the same sale" instead of creating a duplicate.
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState(checkoutAction, initialState);

  // Reset the cart once a checkout succeeds -- adjusted during render
  // (React's documented pattern for resetting state in response to a prop/
  // state change) rather than in an effect, which would call setState
  // synchronously after the fact and trigger a needless extra render.
  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.success) {
      setCart([]);
      setDraftId(crypto.randomUUID());
    }
  }

  const total = useMemo(() => cart.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0), [cart]);

  function addToCart(item: InventoryItem) {
    setCart((current) => {
      const existing = current.find((line) => line.itemId === item.id);
      if (existing) {
        return current.map((line) =>
          line.itemId === item.id ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [
        ...current,
        { itemId: item.id, itemNameSnapshot: item.name, quantity: 1, unitPrice: item.defaultPrice },
      ];
    });
  }

  function removeFromCart(itemId: string) {
    setCart((current) => current.filter((line) => line.itemId !== itemId));
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <h1 className="text-lg font-semibold text-neutral-900">Retail</h1>

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

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-neutral-900">Items</h2>
        {items.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 p-3">
            <span className="text-sm text-neutral-900">
              {item.name} &mdash; ${item.defaultPrice.toFixed(2)}
            </span>
            <Button type="button" variant="secondary" onClick={() => addToCart(item)}>
              Add to cart
            </Button>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-neutral-900">Cart</h2>
        {cart.length === 0 ? <p className="text-sm text-neutral-600">Cart is empty.</p> : null}
        {cart.map((line) => (
          <div key={line.itemId} className="flex items-center justify-between gap-3 text-sm">
            <span>
              {line.itemNameSnapshot} &times; {line.quantity}
            </span>
            <div className="flex items-center gap-2">
              <span>${(line.quantity * line.unitPrice).toFixed(2)}</span>
              <Button type="button" variant="ghost" onClick={() => removeFromCart(line.itemId)}>
                Remove
              </Button>
            </div>
          </div>
        ))}
        {cart.length > 0 ? (
          <p className="text-right text-sm font-semibold text-neutral-900">Total: ${total.toFixed(2)}</p>
        ) : null}
      </div>

      {cart.length > 0 ? (
        <form action={action} className="flex flex-col gap-2">
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <input type="hidden" name="companyId" value={companyId} />
          <input type="hidden" name="branchId" value={branchId} />
          <input type="hidden" name="draftId" value={draftId} />
          <input type="hidden" name="linesJson" value={JSON.stringify(cart)} />
          <Button type="submit" disabled={pending || !branchId}>
            {pending ? "Checking out…" : "Checkout"}
          </Button>
          {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
        </form>
      ) : null}

      {pendingSales.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-neutral-900">Resume a pending sale</h2>
          {pendingSales.map((sale) => (
            <a
              key={sale.id}
              href={`/${companyId}/apps/retail/sale/${sale.id}`}
              className="rounded-md border border-neutral-200 p-3 text-sm text-brand-600 hover:bg-neutral-50"
            >
              Sale {sale.id} &mdash; ${sale.totals.total.toFixed(2)}
            </a>
          ))}
        </div>
      ) : null}

      <a href={`/${companyId}/apps/retail/history`} className="text-sm text-brand-600 hover:underline">
        View sale history
      </a>
    </main>
  );
}
