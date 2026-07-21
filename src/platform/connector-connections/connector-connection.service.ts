import "server-only";

import { FieldValue, type Transaction } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import { writeAuditInTransaction } from "@/core/audit-logs";
import { createItem, getItem, updateItem } from "@/core/inventory-engine";
import { listBranches } from "@/core/companies/branches";
import { listOrderLines, listOrdersForBranch } from "@/core/order-engine";
import { getConnectorContract } from "@/connectors";
import type { NormalizedOutboundOrder, NormalizedOutboundOrderLine } from "@/connectors";

import { deleteConnectorCredential, resolveConnectorCredential, storeConnectorCredential } from "../secrets";
import { isConnectorEntitled } from "../licenses/license.repository";
import { requirePlatformCapability } from "../shared/require-platform-capability";

import { connectorConnectionDoc, getConnectorConnection } from "./connector-connection.repository";
import { finalizePushedOrder, getOutboundOrderMapping, releaseReservation, reserveOutboundOrder } from "./order-mapping.repository";
import { getProductMapping, setProductMapping } from "./product-mapping.repository";
import type { ConnectorConnectionAuditAction, ConnectorSyncSummary } from "./connector-connection.types";

// Business logic only -- same shape as app-installs/app-install.service.ts;
// see that file's header comment for the Server-Action-independence
// rationale and the honest authorization-context caveat.
export class ConnectorNotRegisteredError extends Error {
  constructor(connectorId: string) {
    super(`"${connectorId}" is not a registered connector.`);
    this.name = "ConnectorNotRegisteredError";
  }
}

export class ConnectorNotEntitledError extends Error {
  constructor(connectorId: string) {
    super(`Your plan does not include "${connectorId}".`);
    this.name = "ConnectorNotEntitledError";
  }
}

// Thrown by syncConnector() when there's no connected connection to sync
// -- distinct from ConnectorNotRegisteredError (the connector itself
// doesn't exist) since this is a per-company connection state problem.
export class ConnectorNotConnectedError extends Error {
  constructor(connectorId: string) {
    super(`"${connectorId}" is not connected for this company.`);
    this.name = "ConnectorNotConnectedError";
  }
}

export async function connectConnector(
  companyId: string,
  connectorId: string,
  config: Record<string, unknown>,
): Promise<void> {
  const { session } = await requirePlatformCapability(companyId, "connectors.manage");

  const contract = getConnectorContract(connectorId);
  if (!contract) throw new ConnectorNotRegisteredError(connectorId);
  if (!(await isConnectorEntitled(companyId, connectorId))) throw new ConnectorNotEntitledError(connectorId);

  // The connector itself only validates and normalizes -- Platform
  // persists the result and owns credential storage (Phase 5:
  // result.credential, if any, is moved into Secret Manager here; only the
  // resulting opaque credentialRef and the non-secret safeConfig ever
  // reach Firestore). See docs/phases/PHASE_2_PLAN.md §2/§4 and
  // docs/phases/PHASE_5_PLAN.md §5.
  const result = await contract.connect(config);
  const credentialRef = result.credential
    ? await storeConnectorCredential(companyId, connectorId, result.credential)
    : undefined;

  const ref = connectorConnectionDoc(companyId, connectorId);
  await adminDb.runTransaction(async (transaction: Transaction) => {
    const snap = await transaction.get(ref);
    const before = { status: snap.exists ? (snap.data()?.status ?? "disconnected") : "disconnected" };

    transaction.set(
      ref,
      {
        status: result.status,
        credentialRef: credentialRef ?? null,
        config: result.safeConfig ?? null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    writeAuditInTransaction<ConnectorConnectionAuditAction, "connectorConnection">(transaction, {
      companyId,
      actorId: session.uid,
      action: "connector.connected",
      targetType: "connectorConnection",
      targetId: connectorId,
      before,
      after: { status: result.status },
    });
  });
}

export async function disconnectConnector(companyId: string, connectorId: string): Promise<void> {
  const { session } = await requirePlatformCapability(companyId, "connectors.manage");

  const contract = getConnectorContract(connectorId);
  if (contract) await contract.disconnect();

  const ref = connectorConnectionDoc(companyId, connectorId);
  let hadCredential = false;
  await adminDb.runTransaction(async (transaction: Transaction) => {
    const snap = await transaction.get(ref);
    const before = { status: snap.exists ? (snap.data()?.status ?? "disconnected") : "disconnected" };
    hadCredential = snap.exists && Boolean(snap.data()?.credentialRef);

    transaction.set(
      ref,
      { status: "disconnected", credentialRef: null, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );

    writeAuditInTransaction<ConnectorConnectionAuditAction, "connectorConnection">(transaction, {
      companyId,
      actorId: session.uid,
      action: "connector.disconnected",
      targetType: "connectorConnection",
      targetId: connectorId,
      before,
      after: { status: "disconnected" },
    });
  });

  // Only ever called when a credential was actually stored -- a connector
  // with nothing secret to hold (e.g. custom-api) never touches Secret
  // Manager at all, on connect or disconnect. Best-effort: a delete
  // failure here (e.g. the secret itself was already removed) is a minor
  // cleanup gap, never a correctness or security problem, since
  // resolveConnectorCredential is never called for a disconnected
  // connection.
  if (hadCredential) {
    await deleteConnectorCredential(companyId, connectorId);
  }
}

// The composition point the webhook route handler calls into -- not
// company-scoped (the stub ConnectorContract carries no companyId, and
// this route mounts at /api/webhooks/[connectorId], not under a company
// path). No Core mutation and no audit entry is written here: there is no
// company to attach either to. Phase 5's real connectors don't call any
// external system's webhook-subscription-creation API either -- see
// docs/phases/PHASE_5_PLAN.md §8's documented boundary; sync is on-demand.
export async function handleWebhook(connectorId: string, rawPayload: unknown): Promise<{ receivedAt: string }> {
  const contract = getConnectorContract(connectorId);
  if (!contract) throw new ConnectorNotRegisteredError(connectorId);

  return contract.onWebhook(rawPayload);
}

// Bounded per run (SYNC_ORDER_BATCH_SIZE), same "cap every sync's scan
// cost" precedent as Loyalty's SYNC_PAGE_SIZE. Reserves each candidate
// order transactionally (reserveOutboundOrder) before it's ever included
// in the batch handed to the connector -- the race guard against two
// concurrent "Sync Now" clicks both pushing the same order twice. See
// docs/phases/PHASE_5_PLAN.md §7.
const SYNC_ORDER_BATCH_SIZE = 50;

async function collectOutboundOrders(
  companyId: string,
  connectorId: string,
): Promise<{ orders: NormalizedOutboundOrder[]; reservedOrderIds: string[] }> {
  const branches = await listBranches(companyId);
  const orders: NormalizedOutboundOrder[] = [];
  const reservedOrderIds: string[] = [];

  for (const branch of branches) {
    if (orders.length >= SYNC_ORDER_BATCH_SIZE) break;

    const branchOrders = await listOrdersForBranch(companyId, branch.id);
    for (const order of branchOrders) {
      if (orders.length >= SYNC_ORDER_BATCH_SIZE) break;
      if (order.status !== "completed") continue;

      const existingMapping = await getOutboundOrderMapping(companyId, connectorId, order.id);
      if (existingMapping) continue;

      const reserved = await reserveOutboundOrder(companyId, connectorId, order.id, new Date().toISOString());
      if (!reserved) continue; // a concurrent sync reserved it first

      const lines = await listOrderLines(companyId, order.id);
      const normalizedLines: NormalizedOutboundOrderLine[] = [];
      for (const line of lines) {
        const item = await getItem(companyId, line.itemId);
        normalizedLines.push({ sku: item?.sku, name: line.itemNameSnapshot, quantity: line.quantity, unitPrice: line.unitPrice });
      }

      orders.push({ orderId: order.id, lines: normalizedLines, total: order.totals.total });
      reservedOrderIds.push(order.id);
    }
  }

  return { orders, reservedOrderIds };
}

// Inbound: upserts every discovered product into Core's own Inventory Item
// catalog (name/sku/price only) plus this connector's own productMappings
// doc, which both records the link and guards against re-creating the
// same Core item on a later sync. Deliberately does not touch Core's
// per-branch Stock -- an external product has no branch of its own in this
// design, and guessing one would be exactly the kind of unjustified Core
// change the approved scope forbids. See docs/phases/PHASE_5_PLAN.md §6.
async function upsertProductMappings(
  companyId: string,
  connectorId: string,
  products: { externalId: string; name: string; sku?: string; price?: number; quantity?: number }[],
  syncedAt: string,
): Promise<number> {
  let count = 0;
  for (const product of products) {
    const existing = await getProductMapping(companyId, connectorId, product.externalId);
    let itemId: string;
    if (existing) {
      await updateItem(companyId, existing.itemId, { name: product.name, defaultPrice: product.price ?? 0 });
      itemId = existing.itemId;
    } else {
      const item = await createItem(companyId, {
        sku: product.sku ?? product.externalId,
        name: product.name,
        unit: "unit",
        category: "external",
        defaultPrice: product.price ?? 0,
      });
      itemId = item.id;
    }

    await setProductMapping(companyId, connectorId, product.externalId, itemId, product.quantity, syncedAt);
    count += 1;
  }
  return count;
}

export async function syncConnector(companyId: string, connectorId: string): Promise<ConnectorSyncSummary> {
  const { session } = await requirePlatformCapability(companyId, "connectors.manage");

  const contract = getConnectorContract(connectorId);
  if (!contract) throw new ConnectorNotRegisteredError(connectorId);

  const connection = await getConnectorConnection(companyId, connectorId);
  if (!connection || connection.status !== "connected") throw new ConnectorNotConnectedError(connectorId);

  const credential = connection.credentialRef ? await resolveConnectorCredential(connection.credentialRef) : undefined;
  const { orders: outboundOrders, reservedOrderIds } = await collectOutboundOrders(companyId, connectorId);

  const result = await contract
    .sync({ credential, config: connection.config, outboundOrders })
    .catch(async (error: unknown) => {
      // A sync that fails outright must not leave this run's reservations
      // stuck -- release them all so a later sync retries these orders.
      await Promise.all(reservedOrderIds.map((orderId) => releaseReservation(companyId, connectorId, orderId)));
      throw error;
    });

  const pushedOrders = result.pushedOrders ?? [];
  await Promise.all(
    pushedOrders.map((pushed) => finalizePushedOrder(companyId, connectorId, pushed.orderId, pushed.externalOrderId, result.syncedAt)),
  );

  // Anything reserved this run that the connector neither pushed nor
  // explicitly reported as failed (a connector that silently drops an
  // order) is released too -- never left permanently stuck.
  const pushedIds = new Set(pushedOrders.map((p) => p.orderId));
  const explicitlyFailedIds = new Set(result.failedOrderIds ?? []);
  const toRelease = reservedOrderIds.filter((orderId) => !pushedIds.has(orderId));
  await Promise.all(toRelease.map((orderId) => releaseReservation(companyId, connectorId, orderId)));

  const productsSynced = await upsertProductMappings(companyId, connectorId, result.products ?? [], result.syncedAt);

  await adminDb.runTransaction(async (transaction: Transaction) => {
    transaction.set(
      connectorConnectionDoc(companyId, connectorId),
      { lastSyncAt: result.syncedAt, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );

    writeAuditInTransaction<ConnectorConnectionAuditAction, "connectorConnection">(transaction, {
      companyId,
      actorId: session.uid,
      action: "connector.synced",
      targetType: "connectorConnection",
      targetId: connectorId,
      after: { productsSynced, ordersPushed: pushedIds.size, ordersFailed: explicitlyFailedIds.size },
    });
  });

  return {
    syncedAt: result.syncedAt,
    productsSynced,
    ordersPushed: pushedIds.size,
    ordersFailed: explicitlyFailedIds.size,
  };
}
