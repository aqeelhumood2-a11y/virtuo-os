import path from "node:path";

import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import dotenv from "dotenv";
import { afterEach } from "vitest";

// Fake, disposable Admin SDK credentials for tests that exercise the real
// Firestore Emulator (see .env.test's own header comment for why this is
// safe to commit). Loaded here, once, for every test file -- harmless for
// tests that mock @/lib/firebase/admin entirely and don't touch these
// values at all.
dotenv.config({ path: path.resolve(__dirname, ".env.test") });

afterEach(() => {
  cleanup();
});
