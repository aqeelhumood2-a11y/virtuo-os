# Virtuo OS — Folder Structure

Proposed structure implementing the Core / Apps / Connectors / Settings / Shared layering from `ARCHITECTURE.md` as enforced folder boundaries inside the existing single Next.js app.

```
virtuo-os/
├── docs/                                # this planning doc set
├── scripts/                             # infra/verification scripts (verify-firebase.mjs, etc.)
├── firestore.rules
├── firestore.indexes.json
├── storage.rules
├── firebase.json
├── .firebaserc
│
└── src/
    ├── app/                             # Next.js App Router — routing ONLY, delegates to src/core|apps
    │   ├── (auth)/
    │   │   ├── login/page.tsx
    │   │   ├── register/page.tsx
    │   │   ├── reset-password/page.tsx
    │   │   └── layout.tsx
    │   ├── (dashboard)/
    │   │   └── [companyId]/
    │   │       ├── layout.tsx           # company shell: sidebar, app switcher, branch selector
    │   │       ├── page.tsx             # dashboard home
    │   │       ├── settings/            # renders src/settings
    │   │       ├── apps/
    │   │       │   └── [appId]/[[...slug]]/page.tsx   # mounts the matching App's routes
    │   │       └── admin/               # Super Admin-only screens (licenses, all-companies view)
    │   ├── onboarding/
    │   │   └── create-company/page.tsx
    │   ├── api/
    │   │   ├── webhooks/[connectorId]/route.ts
    │   │   └── ...
    │   ├── layout.tsx
    │   └── globals.css
    │
    ├── core/                            # PERMANENT — no vertical/business-specific logic allowed here
    │   ├── auth/
    │   │   ├── session.ts               # server-side session verification
    │   │   ├── auth-context.tsx          # client Auth provider/hook
    │   │   └── providers/                # email-password.ts, google.ts (later), microsoft.ts (later)
    │   ├── users/
    │   │   ├── user.repository.ts
    │   │   └── user.types.ts
    │   ├── companies/
    │   │   ├── company.repository.ts
    │   │   └── company.types.ts
    │   ├── branches/
    │   │   ├── branch.repository.ts
    │   │   └── branch.types.ts
    │   ├── roles-permissions/
    │   │   ├── capability-matrix.ts     # single source of truth for role → capability grants
    │   │   ├── guards.ts                 # requireCapability(), can()
    │   │   └── membership.repository.ts
    │   ├── licenses/
    │   │   ├── license.repository.ts
    │   │   └── license.types.ts
    │   ├── inventory-engine/
    │   │   ├── domain/                   # Item, StockLevel, Movement entities + invariants
    │   │   ├── application/              # adjustStock(), transferStock(), receiveStock() use-cases
    │   │   └── infrastructure/           # Firestore repositories implementing domain interfaces
    │   ├── order-engine/
    │   │   ├── domain/                   # Order, OrderLine, OrderStatus state machine
    │   │   ├── application/              # createOrder(), transitionStatus(), voidOrder()
    │   │   └── infrastructure/
    │   ├── audit-logs/
    │   │   ├── audit-logger.ts           # single writeAudit() every mutation path calls
    │   │   └── audit-log.types.ts
    │   └── notifications/
    │       ├── notification.repository.ts
    │       ├── channels/                  # in-app.ts, email.ts (later), whatsapp.ts (later)
    │       └── notification.types.ts
    │
    ├── apps-registry/                    # the mechanism that makes Apps installable
    │   ├── app-manifest.types.ts         # AppManifest interface every App must export
    │   ├── registry.ts                   # compile-time registration of all known Apps
    │   └── installed-apps.repository.ts  # per-company install state
    │
    ├── apps/                             # installable business verticals — each isolated, each optional
    │   ├── restaurant/
    │   │   ├── manifest.ts
    │   │   ├── domain/
    │   │   ├── components/
    │   │   └── routes/
    │   ├── coffee-shop/
    │   ├── retail/
    │   ├── warehouse/
    │   ├── manufacturing/
    │   ├── loyalty/
    │   ├── ai-assistant/
    │   ├── whatsapp/
    │   ├── kitchen-display/
    │   └── barcode/
    │       # each folder mirrors: manifest.ts, domain/, components/, routes/
    │
    ├── connectors/                        # external integrations — each isolated, each optional
    │   ├── connector-contract.types.ts    # connect() / sync() / disconnect() / onWebhook()
    │   ├── registry.ts
    │   ├── odoo/
    │   ├── sap/
    │   ├── oracle/
    │   ├── square/
    │   ├── shopify/
    │   └── custom-api/
    │
    ├── settings/                          # per-company configuration surface
    │   ├── branding/
    │   ├── apps-management/               # install/uninstall UI, backed by apps-registry
    │   └── connectors-management/
    │
    ├── shared/                            # cross-cutting, zero business logic
    │   ├── ui/                            # Button, Card, Table, Modal, Form primitives (Tailwind)
    │   ├── hooks/
    │   ├── utils/
    │   ├── types/
    │   └── constants/
    │
    └── lib/
        ├── firebase/                      # already exists: client.ts, admin.ts, config.ts
        └── db/                            # Firestore collection-path helpers + typed converters
```

## Enforcement

- ESLint import-boundary rules (e.g. `eslint-plugin-boundaries` or a custom rule) will enforce:
  - `core/**` may not import from `apps/**` or `connectors/**`.
  - `apps/<x>/**` may not import from `apps/<y>/**` — cross-app communication only through Core engines or explicit shared events.
  - `connectors/**` may not import from `apps/**`.
- This is a Phase 1 setup task, not an afterthought, so the boundary is real from the first commit rather than retrofitted later.
