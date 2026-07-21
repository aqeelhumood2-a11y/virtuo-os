import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Permanent, automated verification of docs/phases/PHASE_2_PLAN.md's
// Platform/Settings split: Platform contains business logic only --
// repositories, services, business rules -- never a Server Action. If this
// regresses, it regresses loudly here rather than silently over time.

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function listPlatformSourceFiles(): string[] {
  const platformDir = path.join(projectRoot, "src", "platform");
  const files: string[] = [];

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
        files.push(fullPath);
      }
    }
  }

  walk(platformDir);
  return files;
}

// A real "use server" directive must be the file's first statement (the
// directive prologue) -- checking only that, rather than grepping the
// whole file body, avoids a false positive on a comment that merely
// mentions the phrase (e.g. explaining why a file deliberately has none).
function hasUseServerDirective(content: string): boolean {
  for (const rawLine of content.split("\n")) {
    const trimmed = rawLine.trim();
    if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;
    return /^["']use server["'];?$/.test(trimmed);
  }
  return false;
}

describe("Platform contains business logic only -- no Server Actions", () => {
  const files = listPlatformSourceFiles();

  it("finds at least one Platform source file (sanity check for the file walk itself)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s has no "use server" directive', (file) => {
    const content = fs.readFileSync(file, "utf8");
    expect(hasUseServerDirective(content)).toBe(false);
  });

  it.each(files)("%s does not accept a (prevState, formData) Server Action signature", (file) => {
    const content = fs.readFileSync(file, "utf8");
    expect(content).not.toMatch(/formData\s*:\s*FormData/);
  });
});
