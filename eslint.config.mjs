import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import importPlugin from "eslint-plugin-import";

// Architecture boundary rules (Virtuo OS Core/Platform/App Registry/Apps/
// Connectors/Settings layering). See docs/ARCHITECTURE.md,
// docs/phases/PHASE_1A_PLAN.md §7, and docs/phases/PHASE_2_PLAN.md
// (Dependency Rules) for the rationale. `import/no-restricted-paths`
// (eslint-plugin-import) matches by *resolved file path*; these zones are
// proven permanently by tests/architecture/import-boundaries.test.ts, not
// by a fixture that gets deleted before commit.
const architectureBoundaries = {
  files: ["src/**/*.{ts,tsx}"],
  plugins: { import: importPlugin },
  rules: {
    "import/no-restricted-paths": [
      "error",
      {
        zones: [
          {
            target: "./src/core/**/*",
            from: ["./src/apps/**/*", "./src/connectors/**/*", "./src/platform/**/*", "./src/app-registry/**/*"],
            message: "Core must not depend on Apps, Connectors, Platform, or App Registry.",
          },
          {
            target: "./src/connectors/**/*",
            from: ["./src/core/**/*", "./src/apps/**/*", "./src/platform/**/*", "./src/app-registry/**/*"],
            message: "Connectors must remain isolated from Core, Apps, Platform, and App Registry.",
          },
          {
            target: "./src/app-registry/**/*",
            from: ["./src/core/**/*", "./src/platform/**/*", "./src/connectors/**/*"],
            message: "App Registry must stay a pure, zero-dependency catalog -- it may not import Core, Platform, or Connectors.",
          },
          {
            target: "./src/apps/**/*",
            from: ["./src/connectors/**/*", "./src/platform/**/*"],
            message: "Apps must not import Connectors or Platform directly -- Apps depend only on Core and their own App Registry manifest.",
          },
          {
            target: "./src/platform/**/*",
            from: ["./src/apps/**/*", "./src/settings/**/*"],
            message: "Platform must not depend on Apps or Settings -- it contains business logic only, called from Settings/Server Actions, never the other way around.",
          },
          {
            target: "./src/settings/**/*",
            from: ["./src/apps/**/*", "./src/connectors/**/*"],
            message: "Settings must not import Apps or Connectors directly -- it lists manifests via App Registry and toggles state via Platform, which is the only module permitted to import Connectors.",
          },
          {
            target: "./src/shared/ui/**/*",
            from: ["./src/shared/config/server-env.ts"],
            message:
              "Client-facing UI must not import the server-only environment module.",
          },
        ],
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  architectureBoundaries,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
