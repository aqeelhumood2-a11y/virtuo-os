import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Permanent, automated verification of the Phase 3 Restaurant plan's
// architectural test requirement: components/ and routes/ under an App
// never import the Admin SDK (server-only, full-trust Firestore access) --
// business logic (and the one place Admin-SDK Firestore access is allowed)
// lives in application/*.repository.ts and *.service.ts. Phase 6's Kitchen
// Display is a deliberate, narrow exception to "never Firestore directly":
// its Client Component reads via the CLIENT Firestore SDK (firebase/firestore,
// not firebase-admin), gated entirely by firestore.rules the same way any
// other caller is -- this test's actual invariant (no Admin SDK, which
// bypasses rules and trusts the caller completely) still holds for it, see
// docs/phases/PHASE_6_PLAN.md §3.

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function listUiSourceFiles(): string[] {
  const appsDir = path.join(projectRoot, "src", "apps");
  const files: string[] = [];

  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
        files.push(fullPath);
      }
    }
  }

  for (const appName of fs.readdirSync(appsDir, { withFileTypes: true })) {
    if (!appName.isDirectory()) continue;
    walk(path.join(appsDir, appName.name, "components"));
    walk(path.join(appsDir, appName.name, "routes"));
  }

  return files;
}

describe("Apps' components/ and routes/ never import Firestore directly", () => {
  const files = listUiSourceFiles();

  it("finds at least one UI source file (sanity check for the file walk itself)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s does not import firebase-admin or the Admin SDK wrapper", (file) => {
    const content = fs.readFileSync(file, "utf8");
    expect(content).not.toMatch(/from ["']firebase-admin/);
    expect(content).not.toMatch(/from ["']@\/lib\/firebase\/admin["']/);
  });
});
