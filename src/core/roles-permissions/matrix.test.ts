import { describe, expect, it } from "vitest";

import { ROLE_CAPABILITIES, outranks } from "./matrix";

describe("ROLE_CAPABILITIES", () => {
  it("grants Owner every capability", () => {
    expect(ROLE_CAPABILITIES.Owner).toEqual(
      expect.arrayContaining([
        "company.view",
        "company.update",
        "company.suspend",
        "branch.view",
        "membership.view",
        "membership.updateRole",
        "membership.deactivate",
        "inventory.view",
        "inventory.write",
        "orders.view",
        "orders.create",
        "orders.complete",
        "orders.void",
        "audit.view",
      ]),
    );
    expect(ROLE_CAPABILITIES.Owner).toHaveLength(14);
  });

  it("grants Manager everything except membership.updateRole and company.suspend", () => {
    expect(ROLE_CAPABILITIES.Manager).not.toContain("membership.updateRole");
    expect(ROLE_CAPABILITIES.Manager).not.toContain("company.suspend");
    expect(ROLE_CAPABILITIES.Manager).toEqual(
      expect.arrayContaining([
        "company.view",
        "company.update",
        "branch.view",
        "membership.view",
        "membership.deactivate",
        "inventory.view",
        "inventory.write",
        "orders.view",
        "orders.create",
        "orders.complete",
        "orders.void",
        "audit.view",
      ]),
    );
  });

  it("grants Supervisor and Employee view + frontline order capabilities, but not inventory.write or orders.void", () => {
    const frontline = [
      "company.view",
      "branch.view",
      "membership.view",
      "inventory.view",
      "orders.view",
      "orders.create",
      "orders.complete",
    ];
    expect(ROLE_CAPABILITIES.Supervisor.sort()).toEqual(frontline.sort());
    expect(ROLE_CAPABILITIES.Employee.sort()).toEqual(frontline.sort());
    expect(ROLE_CAPABILITIES.Supervisor).not.toContain("inventory.write");
    expect(ROLE_CAPABILITIES.Employee).not.toContain("inventory.write");
    expect(ROLE_CAPABILITIES.Supervisor).not.toContain("orders.void");
    expect(ROLE_CAPABILITIES.Employee).not.toContain("orders.void");
    expect(ROLE_CAPABILITIES.Supervisor).not.toContain("audit.view");
    expect(ROLE_CAPABILITIES.Employee).not.toContain("audit.view");
  });
});

describe("outranks", () => {
  it("ranks Owner above every other role", () => {
    expect(outranks("Owner", "Manager")).toBe(true);
    expect(outranks("Owner", "Supervisor")).toBe(true);
    expect(outranks("Owner", "Employee")).toBe(true);
  });

  it("ranks Manager above Supervisor and Employee, but not Owner", () => {
    expect(outranks("Manager", "Supervisor")).toBe(true);
    expect(outranks("Manager", "Employee")).toBe(true);
    expect(outranks("Manager", "Owner")).toBe(false);
  });

  it("returns false for equal ranks", () => {
    expect(outranks("Owner", "Owner")).toBe(false);
    expect(outranks("Manager", "Manager")).toBe(false);
  });

  it("returns false when the actor is lower-ranked than the target", () => {
    expect(outranks("Employee", "Supervisor")).toBe(false);
    expect(outranks("Supervisor", "Manager")).toBe(false);
  });
});
