import "server-only";

import { createOrder, getItemByBarcode } from "@/core";
import type { InventoryItem, Order } from "@/core";

import type { QuickSaleParams } from "../domain/barcode.types";

// Scan-to-lookup: resolves a scanned code straight to its Item via Core's
// getItemByBarcode (Phase 6 addition) -- Barcode owns no data of its own
// here at all, it's a thin read.
export async function lookupByBarcode(companyId: string, barcode: string): Promise<InventoryItem | null> {
  return getItemByBarcode(companyId, barcode);
}

// Scan-to-sell: the same "submit a client-built cart as one idempotent
// createOrder call" pattern Retail's own createSale established (Phase
// 4.1) -- draftId is a client-generated key reused across any retry of
// the same checkout, so Core's own idempotency guarantee (not a second
// App-level check) is what prevents a duplicate sale under concurrency.
export async function quickSale(companyId: string, params: QuickSaleParams): Promise<Order> {
  return createOrder(
    companyId,
    { branchId: params.branchId, appId: "barcode", lines: params.lines },
    { idempotencyKey: params.draftId },
  );
}
