import { customApiConnector } from "./custom-api/connector";
import { odooConnector } from "./odoo/connector";
import { shopifyConnector } from "./shopify/connector";
import { squareConnector } from "./square/connector";
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
// Phase 2 registered exactly one stub; Phase 5 adds the first three real
// connectors, registered here, not via an import side-effect in their own
// files. See docs/phases/PHASE_5_PLAN.md for why Odoo (not SAP/Oracle) is
// the roadmap's Phase 5.3 pick.
registerConnector(customApiConnector);
registerConnector(shopifyConnector);
registerConnector(squareConnector);
registerConnector(odooConnector);
