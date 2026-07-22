import { afterEach, describe, expect, it } from "vitest";

import { getAppManifest, getRegisteredApps, registerApp } from "./registry";
import type { AppManifest } from "./app-manifest.types";

describe("app-registry registry", () => {
  it("has exactly Restaurant (3), Retail (4.1), Loyalty (4.2), Barcode/Kitchen Display/AI Assistant (6) registered", () => {
    expect(getRegisteredApps().map((manifest) => manifest.id).sort()).toEqual([
      "ai-assistant",
      "barcode",
      "kitchen-display",
      "loyalty",
      "restaurant",
      "retail",
    ]);
  });

  it("returns null for an unregistered app id", () => {
    expect(getAppManifest("does-not-exist")).toBeNull();
  });

  describe("registerApp", () => {
    const fake: AppManifest = { id: "fake-app", displayName: "Fake App", routeKey: "fake-app" };

    afterEach(() => {
      // No unregister API exists (apps are never removed from the catalog
      // at runtime) -- re-registering the same id in later tests is
      // idempotent, so no explicit cleanup is needed beyond this comment
      // documenting why.
    });

    it("adds a new manifest, discoverable by id and in the full list", () => {
      registerApp(fake);

      expect(getAppManifest("fake-app")).toBe(fake);
      expect(getRegisteredApps()).toContain(fake);
    });
  });
});
