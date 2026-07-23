import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
    alias: {
      // See test/mocks/server-only.ts for why this is aliased only here.
      "server-only": path.resolve(dirname, "test/mocks/server-only.ts"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: false,
    // Phase 7: e2e/ holds Playwright specs (run via `npm run test:e2e`,
    // a separate runner/process), not Vitest ones -- without this
    // exclusion Vitest also tries to import them and fails, since
    // Playwright's test() can only run under Playwright's own runner.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
