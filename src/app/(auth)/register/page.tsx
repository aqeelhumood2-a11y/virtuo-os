import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { CSRF_COOKIE_NAME } from "@/core/auth/constants";
import { getSession } from "@/core/auth/session";

import { RegisterForm } from "./RegisterForm";

export default async function RegisterPage() {
  const session = await getSession();
  if (session) {
    redirect("/account");
  }

  const cookieStore = await cookies();
  const csrfToken = cookieStore.get(CSRF_COOKIE_NAME)?.value ?? "";

  return <RegisterForm csrfToken={csrfToken} />;
}
