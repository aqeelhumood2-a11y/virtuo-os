import "server-only";

import type { DocumentData } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";

import type { ConnectorConnection } from "./connector-connection.types";

function connectorConnectionsCollection(companyId: string) {
  return adminDb.collection("companies").doc(companyId).collection("connectors");
}

export function connectorConnectionDoc(companyId: string, connectorId: string) {
  return connectorConnectionsCollection(companyId).doc(connectorId);
}

function toConnectorConnection(connectorId: string, data: DocumentData): ConnectorConnection {
  return {
    connectorId,
    status: data.status,
    lastSyncAt: data.lastSyncAt ?? undefined,
    credentialRef: data.credentialRef ?? undefined,
    config: data.config ?? undefined,
  };
}

export async function getConnectorConnection(companyId: string, connectorId: string): Promise<ConnectorConnection | null> {
  const snap = await connectorConnectionDoc(companyId, connectorId).get();
  if (!snap.exists) return null;
  return toConnectorConnection(connectorId, snap.data()!);
}

export async function listCompanyConnectors(companyId: string): Promise<ConnectorConnection[]> {
  const snap = await connectorConnectionsCollection(companyId).get();
  return snap.docs.map((doc) => toConnectorConnection(doc.id, doc.data()));
}
