// Reserved for installable business-vertical Apps. Phase 3 adds the first
// one, src/apps/restaurant -- registered directly by src/app-registry's own
// registry.ts (see that file's comment) and mounted via
// src/app/(dashboard)/[companyId]/apps/[appId]/[[...slug]]/app-roots.ts, so
// no other module needs to import this barrel. It stays empty so the
// import-boundary lint rules have a real, resolvable target for the "Apps"
// zone. Future verticals (Retail, Coffee Shop, Warehouse, Manufacturing,
// Loyalty, AI Assistant, WhatsApp, Kitchen Display, Barcode) each get their
// own src/apps/<name> folder the same way.
export {};
