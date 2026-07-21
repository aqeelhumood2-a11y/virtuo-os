import "server-only";

import { FieldValue, type Transaction } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import { writeAuditInTransaction } from "@/core/audit-logs";

import { DEFAULT_BRANCH_NAME } from "./constants";
import type { OnboardingResult } from "./types";

export class AlreadyOnboardedError extends Error {
  constructor() {
    super("This account has already completed onboarding.");
    this.name = "AlreadyOnboardedError";
  }
}

export type OnboardingParams = {
  uid: string;
  email: string | null;
  companyName: string;
};

// The entire company-creation flow as one Firestore transaction: read the
// user doc to guard against duplicate onboarding, then create/update the
// user profile, the company, its default branch, and the Owner membership
// together. Firestore transactions are all-or-nothing -- there is no
// partial-write state any reader can ever observe, and no Firebase Auth
// mutation happens inside this function (the uid already exists from
// Phase 1B), so there is no cross-service rollback problem to solve.
//
// Concurrency: if two calls race for the same uid, Firestore's optimistic
// concurrency control means the transaction that commits second is
// automatically retried by the Admin SDK against a fresh read -- on retry
// it observes `onboardedAt` already set and throws AlreadyOnboardedError
// instead of creating a second company. No custom locking is required.
export async function runOnboardingTransaction(
  params: OnboardingParams,
): Promise<OnboardingResult> {
  const { uid, email, companyName } = params;

  const userRef = adminDb.collection("users").doc(uid);
  const companyRef = adminDb.collection("companies").doc();
  const branchRef = companyRef.collection("branches").doc();
  const membershipRef = companyRef.collection("memberships").doc(uid);

  await adminDb.runTransaction(async (transaction: Transaction) => {
    const userSnap = await transaction.get(userRef);
    const existingUser = userSnap.exists ? userSnap.data() : undefined;

    if (existingUser?.onboardedAt) {
      throw new AlreadyOnboardedError();
    }

    const now = FieldValue.serverTimestamp();

    transaction.set(
      userRef,
      {
        uid,
        email,
        displayName: existingUser?.displayName ?? null,
        photoURL: existingUser?.photoURL ?? null,
        status: "active",
        createdAt: existingUser?.createdAt ?? now,
        onboardedAt: now,
      },
      { merge: true },
    );

    transaction.set(companyRef, {
      name: companyName,
      ownerId: uid,
      status: "active",
      createdAt: now,
    });

    transaction.set(branchRef, {
      name: DEFAULT_BRANCH_NAME,
      isActive: true,
      isDefault: true,
      createdAt: now,
    });

    transaction.set(membershipRef, {
      uid,
      role: "Owner",
      branchIds: [],
      status: "active",
      joinedAt: now,
    });

    writeAuditInTransaction(transaction, {
      companyId: companyRef.id,
      actorId: uid,
      action: "company.onboarded",
      targetType: "company",
      targetId: companyRef.id,
      after: { name: companyName, status: "active" },
    });
  });

  return { companyId: companyRef.id, branchId: branchRef.id };
}
