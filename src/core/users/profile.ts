import "server-only";

import { cache } from "react";

import { adminDb } from "@/lib/firebase/admin";

import type { UserProfile } from "./types";

export const getUserProfile = cache(async (uid: string): Promise<UserProfile | null> => {
  const snap = await adminDb.collection("users").doc(uid).get();
  if (!snap.exists) return null;

  const data = snap.data();
  if (!data) return null;

  return {
    uid: data.uid,
    email: data.email ?? null,
    displayName: data.displayName ?? null,
    photoURL: data.photoURL ?? null,
    status: data.status,
  };
});
