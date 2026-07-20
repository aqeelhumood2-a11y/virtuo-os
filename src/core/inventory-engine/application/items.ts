import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { requireCapability } from "@/core/roles-permissions";

import { itemDoc, itemsCollection, toItem } from "../infrastructure/refs";
import type { InventoryItem } from "../domain/types";

export type CreateItemInput = {
  sku: string;
  name: string;
  unit: string;
  category: string;
  defaultPrice: number;
};

// Items are company-wide (not branch-scoped) -- only capability-gated,
// unlike stock/movements below which also need branch access.
export async function createItem(companyId: string, input: CreateItemInput): Promise<InventoryItem> {
  await requireCapability(companyId, "inventory.write");

  const ref = itemsCollection(companyId).doc();
  await ref.set({
    ...input,
    isActive: true,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { id: ref.id, ...input, isActive: true };
}

// sku is immutable identity, matching how ownerId/createdAt stay outside
// every allowed-fields update elsewhere in Core (see companies/types.ts).
export type UpdateItemInput = Partial<Pick<InventoryItem, "name" | "unit" | "category" | "defaultPrice">>;

export async function updateItem(companyId: string, itemId: string, input: UpdateItemInput): Promise<void> {
  await requireCapability(companyId, "inventory.write");
  await itemDoc(companyId, itemId).update({ ...input });
}

// Soft-delete only, consistent with "no hard delete anywhere in Core" (1C).
export async function deactivateItem(companyId: string, itemId: string): Promise<void> {
  await requireCapability(companyId, "inventory.write");
  await itemDoc(companyId, itemId).update({ isActive: false });
}

export async function listItems(companyId: string): Promise<InventoryItem[]> {
  await requireCapability(companyId, "inventory.view");
  const snap = await itemsCollection(companyId).get();
  return snap.docs.map((doc) => toItem(doc.id, doc.data()));
}

export async function getItem(companyId: string, itemId: string): Promise<InventoryItem | null> {
  await requireCapability(companyId, "inventory.view");
  const snap = await itemDoc(companyId, itemId).get();
  if (!snap.exists) return null;
  return toItem(snap.id, snap.data()!);
}
