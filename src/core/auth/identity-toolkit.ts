import "server-only";

import { clientEnv } from "@/shared/config/client-env";

const IDENTITY_TOOLKIT_BASE_URL = "https://identitytoolkit.googleapis.com/v1/accounts";

// Firebase's REST error responses put the machine-readable code in
// `error.message`, optionally followed by " : <human detail>" -- we only
// ever look at the code, never the detail, so no internal Firebase error
// text can leak to a caller.
export class IdentityToolkitError extends Error {
  constructor(public readonly firebaseCode: string) {
    super(firebaseCode);
    this.name = "IdentityToolkitError";
  }
}

type IdentityToolkitCredentialResponse = {
  idToken: string;
  localId: string;
};

function extractFirebaseCode(errorBody: unknown): string {
  const message =
    typeof errorBody === "object" &&
    errorBody !== null &&
    "error" in errorBody &&
    typeof (errorBody as { error?: unknown }).error === "object" &&
    (errorBody as { error?: { message?: unknown } }).error !== null
      ? (errorBody as { error?: { message?: unknown } }).error?.message
      : undefined;

  if (typeof message !== "string") return "UNKNOWN_ERROR";
  return message.split(" : ")[0];
}

async function callIdentityToolkit(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<IdentityToolkitCredentialResponse> {
  const response = await fetch(
    `${IDENTITY_TOOLKIT_BASE_URL}:${endpoint}?key=${clientEnv.NEXT_PUBLIC_FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, returnSecureToken: true }),
    },
  );

  const data: unknown = await response.json();

  if (!response.ok) {
    throw new IdentityToolkitError(extractFirebaseCode(data));
  }

  return data as IdentityToolkitCredentialResponse;
}

export async function signUp(
  email: string,
  password: string,
): Promise<IdentityToolkitCredentialResponse> {
  return callIdentityToolkit("signUp", { email, password });
}

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<IdentityToolkitCredentialResponse> {
  return callIdentityToolkit("signInWithPassword", { email, password });
}

export async function sendPasswordResetEmail(email: string): Promise<void> {
  const response = await fetch(
    `${IDENTITY_TOOLKIT_BASE_URL}:sendOobCode?key=${clientEnv.NEXT_PUBLIC_FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestType: "PASSWORD_RESET", email }),
    },
  );

  if (!response.ok) {
    const data: unknown = await response.json();
    throw new IdentityToolkitError(extractFirebaseCode(data));
  }
}

const SAFE_MESSAGES: Record<string, string> = {
  EMAIL_EXISTS: "An account with this email already exists.",
  EMAIL_NOT_FOUND: "Invalid email or password.",
  INVALID_PASSWORD: "Invalid email or password.",
  INVALID_LOGIN_CREDENTIALS: "Invalid email or password.",
  WEAK_PASSWORD: "Password should be at least 6 characters.",
  INVALID_EMAIL: "Please enter a valid email address.",
  USER_DISABLED: "This account has been disabled.",
  TOO_MANY_ATTEMPTS_TRY_LATER: "Too many attempts. Please try again later.",
};

export type SafeAuthError = { code: string; message: string };

// The only place a caught error's detail is inspected. Anything not in the
// explicit allow-list above -- including any raw Firebase/network error --
// collapses to one generic message. Never echoes `error.message` directly.
export function toSafeAuthError(error: unknown): SafeAuthError {
  if (error instanceof IdentityToolkitError) {
    const message = SAFE_MESSAGES[error.firebaseCode];
    if (message) return { code: error.firebaseCode, message };
  }
  return { code: "UNKNOWN_ERROR", message: "Something went wrong. Please try again." };
}
