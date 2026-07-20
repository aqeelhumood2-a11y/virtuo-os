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
      ]),
    );
    expect(ROLE_CAPABILITIES.Owner).toHaveLength(7);
  });

  it("grants Manager everything except membership.updateRole and company.suspend", () => {
    expect(ROLE_CAPABILITIES.Manager).not.toContain("membership.updateRole");
    expect(ROLE_CAPABILITIES.Manager).not.toContain("company.suspend");
    expect(ROLE_CAPABILITIES.Manager).toEqual(
      expect.arrayContaining(["company.view", "company.update", "branch.view", "membership.view", "membership.deactivate"]),
    );
  });

  it("grants Supervisor and Employee view-only capabilities", () => {
    const viewOnly = ["company.view", "branch.view", "membership.view"];
    expect(ROLE_CAPABILITIES.Supervisor.sort()).toEqual(viewOnly.sort());
    expect(ROLE_CAPABILITIES.Employee.sort()).toEqual(viewOnly.sort());
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
