import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import importPlugin from "eslint-plugin-import";

// Architecture boundary rules (Virtuo OS Core/Apps/Connectors/Shared layering).
// See docs/ARCHITECTURE.md and docs/phases/PHASE_1A_PLAN.md §7 for the
// rationale. `import/no-restricted-paths` (eslint-plugin-import) matches by
// *resolved file path*; these zones are proven permanently by
// tests/architecture/import-boundaries.test.ts, not by a fixture that gets
// deleted before commit.
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
            from: ["./src/apps/**/*", "./src/connectors/**/*"],
            message: "Core must not depend on Apps or Connectors.",
          },
          {
            target: "./src/connectors/**/*",
            from: ["./src/core/**/*", "./src/apps/**/*"],
            message: "Connectors must remain isolated from Core and Apps.",
          },
          {
            target: "./src/apps/**/*",
            from: ["./src/connectors/**/*"],
            message: "Apps must not import Connectors directly.",
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
