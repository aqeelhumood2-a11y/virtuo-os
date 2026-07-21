import "server-only";

import { adminDb } from "@/lib/firebase/admin";

// Core's own generic, business-agnostic exactly-once mechanism -- keyed by
// a caller-supplied idempotencyKey, never by business data. Any future Core
// mutation that needs "the same request, retried or raced concurrently,
// must never produce two results" reuses this same collection (tagged by
// its own `operation` value) instead of inventing a new mechanism. This is
// deliberately not a generic key-value store: the only fields ever written
// here are operation/resultId/createdAt, and a key is only ever read or
// written from inside the transaction of the operation that owns it (see
// createOrder in application/orders.ts).
export function idempotencyKeysCollection(companyId: string) {
  return adminDb.collection("companies").doc(companyId).collection("idempotencyKeys");
}

export function idempotencyKeyDoc(companyId: string, key: string) {
  return idempotencyKeysCollection(companyId).doc(key);
}
