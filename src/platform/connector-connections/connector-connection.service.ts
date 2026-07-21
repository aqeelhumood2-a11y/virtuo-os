import "server-only";

import { FieldValue, type Transaction } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import { writeAuditInTransaction } from "@/core/audit-logs";
import { getConnectorContract } from "@/connectors";

import { isConnectorEntitled } from "../licenses/license.repository";
import { requirePlatformCapability } from "../shared/require-platform-capability";

import { connectorConnectionDoc } from "./connector-connection.repository";
import type { ConnectorConnectionAuditAction } from "./connector-connection.types";

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

export async function connectConnector(
  companyId: string,
  connectorId: string,
  config: Record<string, unknown>,
): Promise<void> {
  const { session } = await requirePlatformCapability(companyId, "connectors.manage");

  const contract = getConnectorContract(connectorId);
  if (!contract) throw new ConnectorNotRegisteredError(connectorId);
  if (!(await isConnectorEntitled(companyId, connectorId))) throw new ConnectorNotEntitledError(connectorId);

  // The connector itself only computes the result -- Platform persists it.
  // See docs/phases/PHASE_2_PLAN.md §2/§4.
  const result = await contract.connect(config);

  const ref = connectorConnectionDoc(companyId, connectorId);
  await adminDb.runTransaction(async (transaction: Transaction) => {
    const snap = await transaction.get(ref);
    const before = { status: snap.exists ? (snap.data()?.status ?? "disconnected") : "disconnected" };

    transaction.set(
      ref,
      {
        status: result.status,
        credentialRef: result.credentialRef ?? null,
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
  await adminDb.runTransaction(async (transaction: Transaction) => {
    const snap = await transaction.get(ref);
    const before = { status: snap.exists ? (snap.data()?.status ?? "disconnected") : "disconnected" };

    transaction.set(ref, { status: "disconnected", updatedAt: FieldValue.serverTimestamp() }, { merge: true });

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
}

// The composition point the webhook route handler calls into -- not
// company-scoped (the stub ConnectorContract carries no companyId, and
// this route mounts at /api/webhooks/[connectorId], not under a company
// path). No Core mutation and no audit entry is written here in Phase 2:
// there is no company to attach either to. Real per-company sync wiring
// (resolving which company a webhook belongs to, writing inventory/order
// mutations from its normalized payload) is explicitly Phase 5's job --
// see docs/phases/PHASE_2_PLAN.md §2/§5 and the Remaining Technical Debt
// note in the Phase 2 completion report.
export async function handleWebhook(connectorId: string, rawPayload: unknown): Promise<{ receivedAt: string }> {
  const contract = getConnectorContract(connectorId);
  if (!contract) throw new ConnectorNotRegisteredError(connectorId);

  return contract.onWebhook(rawPayload);
}
