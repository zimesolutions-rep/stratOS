"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth/server";

export type LoginState = { error?: string; sent?: string };

export async function sendMagicLink(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = z.email().safeParse(String(form.get("email") ?? "").trim().toLowerCase());
  if (!email.success) return { error: "Enter a valid work email" };
  const next = String(form.get("next") ?? "/dashboard");
  try {
    await auth().api.signInMagicLink({
      body: {
        email: email.data,
        callbackURL: next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard",
        errorCallbackURL: "/login?error=link",
      },
      headers: await headers(),
    });
  } catch (err) {
    console.error("[login] magic link failed", err);
    return { error: "We couldn't send the link right now. Try again in a minute." };
  }
  return { sent: email.data };
}

export async function signOut() {
  await auth().api.signOut({ headers: await headers() });
  redirect("/login");
}
