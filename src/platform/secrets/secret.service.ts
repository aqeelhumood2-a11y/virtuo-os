import "server-only";

import { gcpProjectId, secretManagerClient } from "./client";

// Google Secret Manager is where every Connector credential actually
// lives -- Firestore's connection doc only ever holds the opaque
// `credentialRef` (a secret version's resource name) this module hands
// back. See docs/DATABASE.md §5 and docs/phases/PHASE_5_PLAN.md §5.
const GRPC_NOT_FOUND = 5;

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === GRPC_NOT_FOUND;
}

function secretId(companyId: string, connectorId: string): string {
  return `connector-${companyId}-${connectorId}`;
}

function secretPath(companyId: string, connectorId: string): string {
  return `projects/${gcpProjectId}/secrets/${secretId(companyId, connectorId)}`;
}

async function ensureSecretExists(companyId: string, connectorId: string): Promise<void> {
  const name = secretPath(companyId, connectorId);
  try {
    await secretManagerClient.getSecret({ name });
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await secretManagerClient.createSecret({
      parent: `projects/${gcpProjectId}`,
      secretId: secretId(companyId, connectorId),
      secret: { replication: { automatic: {} } },
    });
  }
}

// Adds a new version under this connection's secret (creating the secret
// itself on first use) and returns the new version's resource name -- the
// value Platform persists as `credentialRef` on the connection doc. Never
// returns or logs the plaintext value.
export async function storeConnectorCredential(companyId: string, connectorId: string, secretValue: string): Promise<string> {
  await ensureSecretExists(companyId, connectorId);
  const [version] = await secretManagerClient.addSecretVersion({
    parent: secretPath(companyId, connectorId),
    payload: { data: Buffer.from(secretValue, "utf8") },
  });
  if (!version.name) throw new Error("Secret Manager did not return a version name.");
  return version.name;
}

// Resolves a previously stored credentialRef back to its plaintext value,
// for the one request that needs it (connecting to the external system
// during sync). Never persisted anywhere after use.
export async function resolveConnectorCredential(credentialRef: string): Promise<string> {
  const [response] = await secretManagerClient.accessSecretVersion({ name: credentialRef });
  const data = response.payload?.data;
  if (!data) throw new Error("Secret Manager returned no payload for the given credentialRef.");
  return Buffer.from(data).toString("utf8");
}

// Called on disconnect -- removes the secret and all its versions.
// Best-effort: a secret that never existed (a connection with no
// credential at all) is not an error.
export async function deleteConnectorCredential(companyId: string, connectorId: string): Promise<void> {
  try {
    await secretManagerClient.deleteSecret({ name: secretPath(companyId, connectorId) });
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}
