# Settings

The per-company configuration surface: Server Actions, forms, and pages only — no business logic lives here. `apps-management/` and `connectors-management/` call into `platform/`'s services (`installApp`/`uninstallApp`, `connectConnector`/`disconnectConnector`); `branding/` calls into `core/companies/company-settings.ts`'s `updateBrandingAction`. Each `actions.ts` is a thin wrapper: CSRF check, form parsing, calling the underlying service, mapping thrown errors to a form-state message, `revalidatePath`.

Settings depends on Core, Platform, and App Registry (to list the catalog for display). It does not depend on Apps — it lists manifests via App Registry and toggles state via Platform; it never renders or imports real App components. See `docs/phases/PHASE_2_PLAN.md` §2/§5.
