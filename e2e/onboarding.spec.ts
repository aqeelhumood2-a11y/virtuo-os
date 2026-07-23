import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

// Phase 7's one true end-to-end spec: proves the real browser + real
// Next.js server + real Firestore/Auth emulators can complete the single
// most load-bearing flow in the whole app -- register, onboard a company,
// see yourself as its Owner -- with nothing mocked at any layer. This is
// deliberately the only e2e spec added in this pass; broader per-App e2e
// coverage is a natural next increment on top of this now-real harness,
// not attempted here (see docs/phases/PHASE_7_PLAN.md).
test("register, create a company, and see the Owner summary on /account", async ({ page }) => {
  const uniqueId = randomUUID();
  const email = `e2e-${uniqueId}@example.com`;
  const password = `Password${uniqueId.slice(0, 8)}!`;
  const companyName = `Acme ${uniqueId.slice(0, 8)}`;

  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText("You don't belong to a company yet.")).toBeVisible();

  await page.getByRole("link", { name: "Create one" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  await page.getByLabel("Company name").fill(companyName);
  await page.getByRole("button", { name: "Create company" }).click();

  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText(`Company: ${companyName} · Role: Owner`)).toBeVisible();
});
