import { customApiConnector } from "./custom-api/connector";
import type { ConnectorContract } from "./connector-contract.types";

const registry = new Map<string, ConnectorContract>();

export function registerConnector(contract: ConnectorContract): void {
  registry.set(contract.id, contract);
}

export function getRegisteredConnectors(): ConnectorContract[] {
  return Array.from(registry.values());
}

export function getConnectorContract(connectorId: string): ConnectorContract | null {
  return registry.get(connectorId) ?? null;
}

// Compile-time registration of every known connector -- mirrors
// FOLDER_STRUCTURE.md's original "registry.ts: compile-time registration of
// all known Apps" for the App Registry (see app-registry/registry.ts).
// Phase 2 registers exactly one stub; a real connector added later
// (Phase 5) is registered here, not via an import side-effect in its own
// file.
registerConnector(customApiConnector);
