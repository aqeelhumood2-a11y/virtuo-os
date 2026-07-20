"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { CSRF_COOKIE_NAME } from "@/core/auth/constants";
import { csrfTokensMatch } from "@/core/auth/csrf";
import { outranks, requireCapability } from "@/core/roles-permissions";

import { deactivateMembership, getMembership, isLastActiveOwner, updateMembershipRole } from "./membership";
import type { MemberActionFormState } from "./types";

const updateRoleSchema = z.object({
  companyId: z.string().trim().min(1),
  targetUid: z.string().trim().min(1),
  role: z.enum(["Owner", "Manager", "Supervisor", "Employee"]),
});

const targetSchema = z.object({
  companyId: z.string().trim().min(1),
  targetUid: z.string().trim().min(1),
});

async function verifyCsrf(formData: FormData): Promise<boolean> {
  const submitted = formData.get("csrfToken");
  if (typeof submitted !== "string") return false;

  const cookieStore = await cookies();
  const expected = cookieStore.get(CSRF_COOKIE_NAME)?.value;
  return csrfTokensMatch(submitted, expected ?? "");
}

// Owner-only (membership.updateRole is not granted to any other role, see
// core/roles-permissions/matrix.ts) -- requireCapability re-derives both
// the actor's session and membership from Firestore, never from the form.
export async function updateMemberRoleAction(
  _prevState: MemberActionFormState,
  formData: FormData,
): Promise<MemberActionFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  const parsed = updateRoleSchema.safeParse({
    companyId: formData.get("companyId"),
    targetUid: formData.get("targetUid"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { error: "Invalid request." };
  }
  const { companyId, targetUid, role } = parsed.data;

  await requireCapability(companyId, "membership.updateRole");

  const targetMembership = await getMembership(companyId, targetUid);
  if (!targetMembership) {
    return { error: "That member could not be found." };
  }

  if (role !== "Owner" && (await isLastActiveOwner(companyId, targetUid))) {
    return { error: "This is the only active Owner -- assign another Owner first." };
  }

  await updateMembershipRole(companyId, targetUid, role);
  revalidatePath("/account");
  return { success: "Role updated." };
}

export async function deactivateMemberAction(
  _prevState: MemberActionFormState,
  formData: FormData,
): Promise<MemberActionFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  const parsed = targetSchema.safeParse({
    companyId: formData.get("companyId"),
    targetUid: formData.get("targetUid"),
  });
  if (!parsed.success) {
    return { error: "Invalid request." };
  }
  const { companyId, targetUid } = parsed.data;

  const { membership: actorMembership } = await requireCapability(companyId, "membership.deactivate");

  const targetMembership = await getMembership(companyId, targetUid);
  if (!targetMembership) {
    return { error: "That member could not be found." };
  }

  // Capability alone isn't enough: Manager holds membership.deactivate but
  // must never act on an Owner or another Manager -- only Owner can act on
  // anyone (see core/roles-permissions/matrix.ts's role hierarchy).
  if (actorMembership.role !== "Owner" && !outranks(actorMembership.role, targetMembership.role)) {
    return { error: "You don't have permission to deactivate this member." };
  }

  if (await isLastActiveOwner(companyId, targetUid)) {
    return { error: "Cannot deactivate the only active Owner." };
  }

  await deactivateMembership(companyId, targetUid);
  revalidatePath("/account");
  return { success: "Member deactivated." };
}
