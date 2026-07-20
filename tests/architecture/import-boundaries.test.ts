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
});
