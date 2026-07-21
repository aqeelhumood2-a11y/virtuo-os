import "server-only";

import type { DocumentData } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";

import type { InventoryItem, InventoryMovement, MovementType, Stock } from "../domain/types";

export function itemsCollection(companyId: string) {
  return adminDb.collection("companies").doc(companyId).collection("inventoryItems");
}

export function itemDoc(companyId: string, itemId: string) {
  return itemsCollection(companyId).doc(itemId);
}

export function stockCollection(companyId: string) {
  return adminDb.collection("companies").doc(companyId).collection("stock");
}

// One doc per (branch, item) pair -- the key itself gives O(1) lookup with
// no query needed, and doubles as the natural idempotency guard against
// ever creating two stock docs for the same pair.
export function stockDocId(branchId: string, itemId: string): string {
  return `${branchId}_${itemId}`;
}

export function stockDoc(companyId: string, branchId: string, itemId: string) {
  return stockCollection(companyId).doc(stockDocId(branchId, itemId));
}

export function movementsCollection(companyId: string) {
  return adminDb.collection("companies").doc(companyId).collection("inventoryMovements");
}

export function toItem(id: string, data: DocumentData): InventoryItem {
  return {
    id,
    sku: data.sku,
    name: data.name,
    unit: data.unit,
    category: data.category,
    defaultPrice: data.defaultPrice,
    isActive: data.isActive,
  };
}

export function toStock(id: string, data: DocumentData): Stock {
  return {
    id,
    branchId: data.branchId,
    itemId: data.itemId,
    quantityOnHand: data.quantityOnHand,
    reorderPoint: data.reorderPoint ?? 0,
  };
}

export function toMovement(id: string, data: DocumentData): InventoryMovement {
  return {
    id,
    itemId: data.itemId,
    branchId: data.branchId,
    type: data.type as MovementType,
    quantityDelta: data.quantityDelta,
    itemNameSnapshot: data.itemNameSnapshot,
    reason: data.reason,
    performedBy: data.performedBy,
    transferGroupId: data.transferGroupId,
  };
}
