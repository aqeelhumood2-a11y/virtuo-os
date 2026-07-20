import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { CSRF_COOKIE_NAME } from "@/core/auth/constants";
import { getSession } from "@/core/auth/session";

import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  const session = await getSession();
  if (session) {
    redirect("/account");
  }

  const cookieStore = await cookies();
  const csrfToken = cookieStore.get(CSRF_COOKIE_NAME)?.value ?? "";

  return <LoginForm csrfToken={csrfToken} />;
}
