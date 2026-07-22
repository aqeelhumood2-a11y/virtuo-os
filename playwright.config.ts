import { defineConfig } from "@playwright/test";

// Phase 7: the e2e harness. Run via `npm run test:e2e`, which wraps this
// entire command in `firebase emulators:exec` (same mechanism
// `test:emulator` already uses for Vitest) -- that injects
// FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST into every child
// process, including the `next dev` server webServer starts below, so the
// real app under test talks to the emulator, never a real project, with
// zero e2e-specific code in the app itself. Chromium is pre-installed in
// this environment (PLAYWRIGHT_BROWSERS_PATH); no `playwright install`
// needed or run.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        launchOptions: {
          executablePath: "/opt/pw-browsers/chromium",
        },
      },
    },
  ],
});
