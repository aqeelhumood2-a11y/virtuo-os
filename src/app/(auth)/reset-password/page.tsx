import { cookies } from "next/headers";

import { CSRF_COOKIE_NAME } from "@/core/auth/constants";

import { ResetPasswordForm } from "./ResetPasswordForm";

export default async function ResetPasswordPage() {
  const cookieStore = await cookies();
  const csrfToken = cookieStore.get(CSRF_COOKIE_NAME)?.value ?? "";

  return <ResetPasswordForm csrfToken={csrfToken} />;
}
