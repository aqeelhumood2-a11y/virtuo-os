// Reserved for installable business-vertical Apps (Restaurant, Retail,
// Coffee Shop, Warehouse, Manufacturing, Loyalty, AI Assistant, WhatsApp,
// Kitchen Display, Barcode). Populated starting Phase 3, after the first
// vertical is chosen. Empty on purpose -- Phase 2 built the install
// mechanism (src/app-registry, src/platform/app-installs, the dynamic
// [companyId]/apps/[appId] mount route) against this empty registry, so
// it's fully tested ahead of a real App. This file exists so the
// import-boundary lint rules have a real, resolvable target.
export {};
