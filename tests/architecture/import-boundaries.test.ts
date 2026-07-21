import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// Permanent verification that the import-boundary rules in eslint.config.mjs
// actually fire — replaces the "add a fixture, confirm it fails, delete it"
// approach with a real, committed test that runs on every `npm run test`
// and every CI run. See docs/phases/PHASE_1A_PLAN.md §7.

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

async function lintAsFile(relativeFilePath: string, code: string) {
  const eslint = new ESLint({
    cwd: projectRoot,
    overrideConfigFile: path.join(projectRoot, "eslint.config.mjs"),
  });
  const [result] = await eslint.lintText(code, {
    filePath: path.join(projectRoot, relativeFilePath),
  });
  return result;
}

function restrictedPathErrors(result: Awaited<ReturnType<typeof lintAsFile>>) {
  return result.messages.filter(
    (message) => message.ruleId === "import/no-restricted-paths" && message.severity === 2,
  );
}

describe("architecture import boundaries", () => {
  it("forbids Core importing from Apps", async () => {
    const result = await lintAsFile(
      "src/core/__boundary_fixture__.ts",
      `import "../apps";\nexport {};\n`,
    );
    expect(restrictedPathErrors(result)).not.toHaveLength(0);
  });

  it("forbids Core importing from Connectors", async () => {
    const result = await lintAsFile(
      "src/core/__boundary_fixture__.ts",
      `import "../connectors";\nexport {};\n`,
    );
    expect(restrictedPathErrors(result)).not.toHaveLength(0);
  });

  it("forbids Connectors importing from Apps", async () => {
    const result = await lintAsFile(
      "src/connectors/__boundary_fixture__.ts",
      `import "../apps";\nexport {};\n`,
    );
    expect(restrictedPathErrors(result)).not.toHaveLength(0);
  });

  it("forbids Connectors importing from Core (isolation)", async () => {
    const result = await lintAsFile(
      "src/connectors/__boundary_fixture__.ts",
      `import "../core";\nexport {};\n`,
    );
    expect(restrictedPathErrors(result)).not.toHaveLength(0);
  });

  it("forbids Apps importing from Connectors", async () => {
    const result = await lintAsFile(
      "src/apps/__boundary_fixture__.ts",
      `import "../connectors";\nexport {};\n`,
    );
    expect(restrictedPathErrors(result)).not.toHaveLength(0);
  });

  it("forbids client-facing UI from importing the server-only env module", async () => {
    const result = await lintAsFile(
      "src/shared/ui/__boundary_fixture__.ts",
      `import "../config/server-env";\nexport {};\n`,
    );
    expect(restrictedPathErrors(result)).not.toHaveLength(0);
  });

  it("allows Apps importing from Core's barrel (negative control)", async () => {
    const result = await lintAsFile(
      "src/apps/__boundary_fixture_valid__.ts",
      `import "../core";\nexport {};\n`,
    );
    expect(restrictedPathErrors(result)).toHaveLength(0);
  });

  it("allows Core importing from Shared (negative control)", async () => {
    const result = await lintAsFile(
      "src/core/__boundary_fixture_valid__.ts",
      `import "../shared/types";\nexport {};\n`,
    );
    expect(restrictedPathErrors(result)).toHaveLength(0);
  });

  // --- Phase 2: Platform / App Registry layering --------------------------
  // See docs/phases/PHASE_2_PLAN.md's Dependency Rules section -- these
  // zones are the mechanical enforcement of that permanent, written rule.

  it("forbids Core importing from Platform", async () => {
    const result = await lintAsFile(
      "src/core/__boundary_fixture__.ts",
      `import "../platform";\nexport {};\n`,
    );
    expect(restrictedPathErrors(result)).not.toHaveLength(0);
  });

  it("forbids Core importing from App Registry", async () => {
    const result = await lintAsFile(
      "src/core/__boundary_fixture__.ts",
      `import "../app-registry";\nexport {};\n`,
    );
    expect(restrictedPathErrors(result)).not.toHaveLength(0);
  });

  it("forbids Connectors importing from Platform (isolation)", async () => {
    const result = await lintAsFile(
      "src/connectors/__boundary_fixture__.ts",
      `import "../platform";\nexport {};\n`,
    );
    expect(restrictedPathErrors(result)).not.toHaveLength(0);
  });

  it("forbids Connectors importing from App Registry (isolation)", async () => {
    const result = await lintAsFile(
      "src/connectors/__boundary_fixture__.ts",
      `import "../app-registry";\nexport {};\n`,
    );
    expect(restrictedPathErrors(result)).not.toHaveLength(0);
  });

  it("forbids App Registry importing from Core", async () => {
    const result = await lintAsFile(
      "src/app-registry/__boundary_fixture__.ts",
      `import "../core";\nexport {};\n`,
    );
    expect(restrictedPathErrors(result)).not.toHaveLength(0);
  });

  it("forbids App Registry importing from Platform", async () => {
    const result = await lintAsFile(
      "src/app-registry/__boundary_fixture__.ts",
      `import "../platform";\nexport {};\n`,
    );
    expect(restrictedPathErrors(result)).not.toHaveLength(0);
  });

  it("forbids App Registry importing from Connectors", async () => {
    const result = await lintAsFile(
      "src/app-registry/__boundary_fixture__.ts",
      `import "../connectors";\nexport {};\n`,
    );
    expect(restrictedPathErrors(result)).not.toHaveLength(0);
  });

  it("forbids Apps importing from Platform (Apps depend only on Core and their own App Registry manifest)", async () => {
    const result = await lintAsFile(
      "src/apps/__boundary_fixture__.ts",
      `import "../platform";\nexport {};\n`,
    );
    expect(restrictedPathErrors(result)).not.toHaveLength(0);
  });

  it("forbids Platform importing from Apps (business logic must not depend on a UI-adjacent layer)", async () => {
    const result = await lintAsFile(
      "src/platform/__boundary_fixture__.ts",
      `import "../apps";\nexport {};\n`,
    );
    expect(restrictedPathErrors(result)).not.toHaveLength(0);
  });

  it("forbids Platform importing from Settings (Settings calls Platform, never the reverse)", async () => {
    const result = await lintAsFile(
      "src/platform/__boundary_fixture__.ts",
      `import "../settings";\nexport {};\n`,
    );
    expect(restrictedPathErrors(result)).not.toHaveLength(0);
  });

  it("forbids Settings importing from Apps directly", async () => {
    const result = await lintAsFile(
      "src/settings/__boundary_fixture__.ts",
      `import "../apps";\nexport {};\n`,
    );
    expect(restrictedPathErrors(result)).not.toHaveLength(0);
  });

  it("forbids Settings importing from Connectors directly (only Platform may)", async () => {
    const result = await lintAsFile(
      "src/settings/__boundary_fixture__.ts",
      `import "../connectors";\nexport {};\n`,
    );
    expect(restrictedPathErrors(result)).not.toHaveLength(0);
  });

  it("allows Platform importing from Core, App Registry, and Connectors (negative control)", async () => {
    const coreResult = await lintAsFile(
      "src/platform/__boundary_fixture_valid_core__.ts",
      `import "../core";\nexport {};\n`,
    );
    const registryResult = await lintAsFile(
      "src/platform/__boundary_fixture_valid_registry__.ts",
      `import "../app-registry";\nexport {};\n`,
    );
    const connectorsResult = await lintAsFile(
      "src/platform/__boundary_fixture_valid_connectors__.ts",
      `import "../connectors";\nexport {};\n`,
    );
    expect(restrictedPathErrors(coreResult)).toHaveLength(0);
    expect(restrictedPathErrors(registryResult)).toHaveLength(0);
    expect(restrictedPathErrors(connectorsResult)).toHaveLength(0);
  });

  it("allows Settings importing from Core, Platform, and App Registry (negative control)", async () => {
    const coreResult = await lintAsFile(
      "src/settings/__boundary_fixture_valid_core__.ts",
      `import "../core";\nexport {};\n`,
    );
    const platformResult = await lintAsFile(
      "src/settings/__boundary_fixture_valid_platform__.ts",
      `import "../platform";\nexport {};\n`,
    );
    const registryResult = await lintAsFile(
      "src/settings/__boundary_fixture_valid_registry__.ts",
      `import "../app-registry";\nexport {};\n`,
    );
    expect(restrictedPathErrors(coreResult)).toHaveLength(0);
    expect(restrictedPathErrors(platformResult)).toHaveLength(0);
    expect(restrictedPathErrors(registryResult)).toHaveLength(0);
  });
});
