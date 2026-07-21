import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Permanent, automated verification of the Phase 3 App Registry design:
// AppManifest carries only a `routeKey` string, never a React
// ComponentType -- the routeKey -> Component map lives at the Next.js route
// layer (src/app/.../app-roots.ts), not here. If a future edit ever
// reintroduces a React import into App Registry, this fails loudly.

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function listAppRegistrySourceFiles(): string[] {
  const dir = path.join(projectRoot, "src", "app-registry");
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts"))
    .map((entry) => path.join(dir, entry.name));
}

describe("App Registry stays UI-independent -- no React import anywhere in src/app-registry", () => {
  const files = listAppRegistrySourceFiles();

  it("finds at least one App Registry source file (sanity check for the file walk itself)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s does not import react", (file) => {
    const content = fs.readFileSync(file, "utf8");
    expect(content).not.toMatch(/from ["']react["']/);
  });
});
