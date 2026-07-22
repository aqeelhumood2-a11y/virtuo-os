"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";

import type { Branch } from "@/core";
import { Button } from "@/shared/ui";

import { lookupBarcodeAction, quickSaleAction, type BarcodeActionFormState } from "../actions";
import type { QuickSaleLineInput } from "../domain/barcode.types";

const lookupInitialState: BarcodeActionFormState = {};
const saleInitialState: BarcodeActionFormState = {};

// Scan-to-lookup and scan-to-sell in one screen: a barcode scanner is a
// keyboard-wedge device (types the code, then Enter), so the lookup form
// below needs nothing beyond a focused text input and a submit -- no
// camera/decoding logic belongs in this App at all.
export function BarcodeScanner({ companyId, csrfToken, branches }: { companyId: string; csrfToken: string; branches: Branch[] }) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [cart, setCart] = useState<QuickSaleLineInput[]>([]);
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const inputRef = useRef<HTMLInputElement>(null);

  const [lookupState, lookupAction, lookupPending] = useActionState(lookupBarcodeAction, lookupInitialState);
  const [saleState, saleAction, salePending] = useActionState(quickSaleAction, saleInitialState);

  // Adjust state during render (React's documented pattern, same as
  // Retail's ItemBrowser) rather than an effect: a newly-found item is
  // surfaced once per lookup submission, never re-added on an unrelated
  // re-render.
  const [lastLookup, setLastLookup] = useState(lookupState);
  if (lookupState !== lastLookup) {
    setLastLookup(lookupState);
    if (lookupState.success && lookupState.item) {
      const found = lookupState.item;
      setCart((current) => {
        const existing = current.find((line) => line.itemId === found.id);
        if (existing) {
          return current.map((line) => (line.itemId === found.id ? { ...line, quantity: line.quantity + 1 } : line));
        }
        return [...current, { itemId: found.id, itemNameSnapshot: found.name, quantity: 1, unitPrice: found.defaultPrice }];
      });
    }
  }

  useEffect(() => {
    inputRef.current?.focus();
  }, [lookupState]);

  const [lastSale, setLastSale] = useState(saleState);
  if (saleState !== lastSale) {
    setLastSale(saleState);
    if (saleState.success) {
      setCart([]);
      setDraftId(crypto.randomUUID());
    }
  }

  const total = useMemo(() => cart.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0), [cart]);

  function removeFromCart(itemId: string) {
    setCart((current) => current.filter((line) => line.itemId !== itemId));
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <h1 className="text-lg font-semibold text-neutral-900">Barcode</h1>

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

      <form action={lookupAction} className="flex flex-col gap-2">
        <input type="hidden" name="csrfToken" value={csrfToken} />
        <input type="hidden" name="companyId" value={companyId} />
        <label className="flex flex-col gap-1.5 text-sm font-medium text-neutral-900">
          Scan or enter a barcode
          <input
            ref={inputRef}
            autoFocus
            name="barcode"
            className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900"
          />
        </label>
        <Button type="submit" variant="secondary" disabled={lookupPending}>
          {lookupPending ? "Looking up…" : "Look up"}
        </Button>
        {lookupState.error ? <p className="text-sm text-red-600">{lookupState.error}</p> : null}
      </form>

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
        <form action={saleAction} className="flex flex-col gap-2">
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <input type="hidden" name="companyId" value={companyId} />
          <input type="hidden" name="branchId" value={branchId} />
          <input type="hidden" name="draftId" value={draftId} />
          <input type="hidden" name="linesJson" value={JSON.stringify(cart)} />
          <Button type="submit" disabled={salePending || !branchId}>
            {salePending ? "Completing sale…" : "Complete sale"}
          </Button>
          {saleState.error ? <p className="text-sm text-red-600">{saleState.error}</p> : null}
          {saleState.success ? <p className="text-sm text-neutral-600">{saleState.success}</p> : null}
        </form>
      ) : null}
    </main>
  );
}
