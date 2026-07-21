export type AuthFormState = {
  error?: string;
  success?: string;
};

export type AuthSession = {
  uid: string;
  email: string | null;
  // Fast-path UI cache of the { superAdmin } custom claim (ARCHITECTURE.md
  // §5) -- NOT an authorization source. Every capability check re-derives
  // the actor's role from Firestore via requireCapability(); this field
  // exists only so UI can show/hide ops-only affordances without an extra
  // read.
  superAdmin: boolean;
};
