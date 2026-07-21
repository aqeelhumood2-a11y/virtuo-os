import { describe, expect, it } from "vitest";

import { registerApp } from "./registry";
import { resolveAppRoute } from "./resolve-route";

describe("resolveAppRoute", () => {
  it("returns null when isInstalled is false, without even checking the catalog", () => {
    registerApp({ id: "widgets", displayName: "Widgets" });

    expect(resolveAppRoute("widgets", false)).toBeNull();
  });

  it("returns null when installed but the appId isn't a registered manifest", () => {
    expect(resolveAppRoute("not-a-real-app", true)).toBeNull();
  });

  it("returns the manifest when installed and registered", () => {
    const manifest = { id: "reports", displayName: "Reports" };
    registerApp(manifest);

    expect(resolveAppRoute("reports", true)).toEqual(manifest);
  });
});
