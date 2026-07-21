"use client";

import { useActionState } from "react";

import { deactivateMemberAction, updateMemberRoleAction } from "@/core/companies/members-actions";
import type { MemberActionFormState, Membership, MembershipRole } from "@/core/companies/types";
import { outranks } from "@/core/roles-permissions/matrix";
import { Button } from "@/shared/ui";

const ASSIGNABLE_ROLES: MembershipRole[] = ["Owner", "Manager", "Supervisor", "Employee"];

const initialState: MemberActionFormState = {};

function RoleForm({
  csrfToken,
  companyId,
  member,
}: {
  csrfToken: string;
  companyId: string;
  member: Membership;
}) {
  const [state, action, pending] = useActionState(updateMemberRoleAction, initialState);

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="targetUid" value={member.uid} />
      <select
        name="role"
        defaultValue={member.role}
        className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-sm text-neutral-900"
      >
        {ASSIGNABLE_ROLES.map((role) => (
          <option key={role} value={role}>
            {role}
          </option>
        ))}
      </select>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
      {state.error ? (
        <span role="alert" className="w-full text-xs text-red-600">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

function DeactivateForm({
  csrfToken,
  companyId,
  member,
}: {
  csrfToken: string;
  companyId: string;
  member: Membership;
}) {
  const [state, action, pending] = useActionState(deactivateMemberAction, initialState);

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="targetUid" value={member.uid} />
      <Button type="submit" variant="ghost" disabled={pending}>
        {pending ? "Deactivating…" : "Deactivate"}
      </Button>
      {state.error ? (
        <span role="alert" className="w-full text-xs text-red-600">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

// UI-level guards only (hide/disable) -- the real enforcement is
// requireCapability()/outranks() re-checked server-side in
// core/companies/members-actions.ts on every submit, per the approved
// Phase 1D plan §5. A hidden or disabled control here is a UX nicety, not
// the authorization boundary.
export function MembersList({
  csrfToken,
  companyId,
  members,
  actorUid,
  actorRole,
  canUpdateRole,
  canDeactivate,
}: {
  csrfToken: string;
  companyId: string;
  members: Membership[];
  actorUid: string;
  actorRole: MembershipRole;
  canUpdateRole: boolean;
  canDeactivate: boolean;
}) {
  return (
    <ul className="flex flex-col gap-3 text-left text-sm">
      {members.map((member) => {
        const canDeactivateThis =
          canDeactivate && (actorRole === "Owner" || outranks(actorRole, member.role));

        return (
          <li key={member.uid} className="flex flex-col gap-2 border-b border-neutral-100 pb-3">
            <span className="text-neutral-900">
              {member.uid === actorUid ? "You" : member.uid} · {member.role}
            </span>
            {canUpdateRole ? (
              <RoleForm csrfToken={csrfToken} companyId={companyId} member={member} />
            ) : null}
            {canDeactivateThis ? (
              <DeactivateForm csrfToken={csrfToken} companyId={companyId} member={member} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
