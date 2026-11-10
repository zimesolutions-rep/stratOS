"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { TENANT_COOKIE } from "@/lib/tenant";

/** Remembers which workspace to open. Membership is still checked by the database on every query. */
export async function switchTenant(id: string) {
  if (!z.uuid().safeParse(id).success) return;
  (await cookies()).set(TENANT_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect("/dashboard");
}
