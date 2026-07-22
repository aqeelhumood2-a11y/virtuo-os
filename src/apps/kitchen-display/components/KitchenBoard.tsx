"use client";

import { useActionState, useEffect, useState } from "react";
import { signInWithCustomToken } from "firebase/auth";
import { collection, onSnapshot, query, where, type Unsubscribe } from "firebase/firestore";

import { mintClientAuthTokenAction } from "@/core/auth/actions";
import { auth, db } from "@/lib/firebase/client";
import { Button } from "@/shared/ui";

import { advanceStageAction, type KitchenDisplayActionFormState } from "../actions";
import { nextStage, type PrepStage } from "../domain/prep-status.types";

type BoardOrder = { orderId: string; status: string; total: number };
type BoardEntry = { orderId: string; status: string; total: number; stage: PrepStage };

const cardActionInitialState: KitchenDisplayActionFormState = {};

function QueueCard({ companyId, csrfToken, entry }: { companyId: string; csrfToken: string; entry: BoardEntry }) {
  const [state, action, pending] = useActionState(advanceStageAction, cardActionInitialState);
  const upcoming = nextStage(entry.stage);

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 p-3">
      <div className="flex flex-col">
        <span className="text-sm font-medium text-neutral-900">
          Order {entry.orderId} &mdash; ${entry.total.toFixed(2)}
        </span>
        <span className="text-xs uppercase tracking-wide text-neutral-500">{entry.stage}</span>
      </div>
      {upcoming ? (
        <form action={action}>
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <input type="hidden" name="companyId" value={companyId} />
          <input type="hidden" name="orderId" value={entry.orderId} />
          <input type="hidden" name="stage" value={upcoming} />
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? "Updating…" : `Mark ${upcoming}`}
          </Button>
        </form>
      ) : (
        <span className="text-xs text-neutral-500">Done</span>
      )}
      {state.error ? <span className="text-xs text-red-600">{state.error}</span> : null}
    </div>
  );
}

// The first Client Component in this codebase to read Firestore directly
// (via the client SDK, not a Server Component/Action) -- see
// docs/phases/PHASE_6_PLAN.md §3. Authorization is enforced entirely by
// the existing firestore.rules, exactly as for every server-side read;
// nothing here bypasses them. mintClientAuthTokenAction bridges the
// already-verified server session to a real client-side Firebase Auth
// identity once per mount (skipped if one is already established), so
// request.auth is populated for the rules to evaluate.
export function KitchenBoard({
  companyId,
  branchId,
  csrfToken,
  initialQueue,
}: {
  companyId: string;
  branchId: string;
  csrfToken: string;
  initialQueue: BoardEntry[];
}) {
  const [orders, setOrders] = useState<Map<string, BoardOrder>>(
    new Map(initialQueue.map((entry) => [entry.orderId, { orderId: entry.orderId, status: entry.status, total: entry.total }])),
  );
  const [stages, setStages] = useState<Map<string, PrepStage>>(
    new Map(initialQueue.map((entry) => [entry.orderId, entry.stage])),
  );
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    let unsubscribeOrders: Unsubscribe | undefined;
    let unsubscribeStages: Unsubscribe | undefined;
    let cancelled = false;

    async function connect() {
      if (!auth.currentUser) {
        const result = await mintClientAuthTokenAction();
        if ("error" in result) {
          if (!cancelled) setConnectionError(result.error);
          return;
        }
        await signInWithCustomToken(auth, result.token);
      }
      if (cancelled) return;

      const ordersQuery = query(collection(db, "companies", companyId, "orders"), where("branchId", "==", branchId));
      unsubscribeOrders = onSnapshot(
        ordersQuery,
        (snapshot) => {
          setOrders((current) => {
            const next = new Map(current);
            snapshot.docChanges().forEach((change) => {
              if (change.type === "removed") {
                next.delete(change.doc.id);
                return;
              }
              const data = change.doc.data();
              next.set(change.doc.id, { orderId: change.doc.id, status: data.status, total: data.totals?.total ?? 0 });
            });
            return next;
          });
        },
        (error) => setConnectionError(error.message),
      );

      const stagesQuery = query(
        collection(db, "companies", companyId, "apps", "kitchen-display", "prepStatus"),
        where("branchId", "==", branchId),
      );
      unsubscribeStages = onSnapshot(
        stagesQuery,
        (snapshot) => {
          setStages((current) => {
            const next = new Map(current);
            snapshot.docChanges().forEach((change) => {
              if (change.type === "removed") return;
              next.set(change.doc.id, change.doc.data().stage as PrepStage);
            });
            return next;
          });
        },
        (error) => setConnectionError(error.message),
      );
    }

    void connect();
    return () => {
      cancelled = true;
      unsubscribeOrders?.();
      unsubscribeStages?.();
    };
  }, [companyId, branchId]);

  const entries: BoardEntry[] = Array.from(orders.values())
    .filter((order) => order.status !== "voided")
    .map((order) => ({ ...order, stage: stages.get(order.orderId) ?? "queued" }));

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <h1 className="text-lg font-semibold text-neutral-900">Kitchen Display</h1>
      {connectionError ? (
        <p className="text-sm text-red-600">Live updates unavailable: {connectionError}. Refresh to retry.</p>
      ) : null}
      <div className="flex flex-col gap-2">
        {entries.length === 0 ? <p className="text-sm text-neutral-600">No orders in the queue.</p> : null}
        {entries.map((entry) => (
          <QueueCard key={entry.orderId} companyId={companyId} csrfToken={csrfToken} entry={entry} />
        ))}
      </div>
    </main>
  );
}
