import "server-only";

import { FieldValue, type Transaction } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import { writeAuditInTransaction } from "@/core/audit-logs";
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
// unlike stock/movements below which also need branch access. Wrapped in
// a transaction (1G) so the write and its audit log entry commit
// atomically -- these three functions had no transaction of their own
// before 1G's "every mutation is audited, no exceptions" requirement.
export async function createItem(companyId: string, input: CreateItemInput): Promise<InventoryItem> {
  const { session } = await requireCapability(companyId, "inventory.write");

  const ref = itemsCollection(companyId).doc();

  await adminDb.runTransaction(async (transaction: Transaction) => {
    transaction.set(ref, {
      ...input,
      isActive: true,
      createdAt: FieldValue.serverTimestamp(),
    });

    writeAuditInTransaction(transaction, {
      companyId,
      actorId: session.uid,
      action: "inventory.itemCreated",
      targetType: "inventoryItem",
      targetId: ref.id,
      after: { ...input, isActive: true },
    });
  });

  return { id: ref.id, ...input, isActive: true };
}

// sku is immutable identity, matching how ownerId/createdAt stay outside
// every allowed-fields update elsewhere in Core (see companies/types.ts).
export type UpdateItemInput = Partial<Pick<InventoryItem, "name" | "unit" | "category" | "defaultPrice">>;

export async function updateItem(companyId: string, itemId: string, input: UpdateItemInput): Promise<void> {
  const { session } = await requireCapability(companyId, "inventory.write");
  const ref = itemDoc(companyId, itemId);

  await adminDb.runTransaction(async (transaction: Transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) throw new Error("Item not found.");
    const before = snap.data()!;

    transaction.update(ref, { ...input });

    writeAuditInTransaction(transaction, {
      companyId,
      actorId: session.uid,
      action: "inventory.itemUpdated",
      targetType: "inventoryItem",
      targetId: itemId,
      before: Object.fromEntries(Object.keys(input).map((key) => [key, before[key]])),
      after: input,
    });
  });
}

// Soft-delete only, consistent with "no hard delete anywhere in Core" (1C).
export async function deactivateItem(companyId: string, itemId: string): Promise<void> {
  const { session } = await requireCapability(companyId, "inventory.write");
  const ref = itemDoc(companyId, itemId);

  await adminDb.runTransaction(async (transaction: Transaction) => {
    transaction.update(ref, { isActive: false });

    writeAuditInTransaction(transaction, {
      companyId,
      actorId: session.uid,
      action: "inventory.itemDeactivated",
      targetType: "inventoryItem",
      targetId: itemId,
      before: { isActive: true },
      after: { isActive: false },
    });
  });
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
