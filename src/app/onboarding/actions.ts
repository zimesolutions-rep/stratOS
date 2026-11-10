"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { actionError } from "@/lib/api";
import { currentUserId } from "@/lib/auth/current-user";
import { asTenantUser } from "@/lib/db";
import { INDUSTRIES, REGIMES } from "@/lib/stratos/types";
import { TENANT_COOKIE } from "@/lib/tenant";

export type OnboardingState = { error?: string };

const input = z.object({
  name: z.string().trim().min(2, "Enter your company or workspace name").max(80),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/, "Use 3 to 48 lowercase letters, digits or hyphens"),
  industry: z.enum(INDUSTRIES, "Pick your industry"),
  regimes: z.array(z.enum(REGIMES)).min(1, "Pick at least one data protection law"),
  region: z.enum(["in", "eu", "us"]),
});

/**
 * Creates the workspace through stratos.create_tenant(), which makes the caller its owner and seeds pipeline
 * stages, a starter cadence and scoring rules from the industry template, all in one transaction.
 */
export async function createWorkspace(_prev: OnboardingState, form: FormData): Promise<OnboardingState> {
  const userId = await currentUserId();
  if (!userId) redirect("/login?next=/onboarding");
  let id: string;
  try {
    const v = input.parse({
      name: form.get("name"), slug: form.get("slug"), industry: form.get("industry"),
      regimes: form.getAll("regimes"), region: form.get("region"),
    });
    id = await asTenantUser(userId, null, async (db) => (await db.query<{ id: string }>(
      "select stratos.create_tenant($1, $2, $3::stratos.industry, $4::text[], $5) as id",
      [v.name, v.slug, v.industry, v.regimes, v.region])).rows[0].id);
  } catch (err) {
    const e = err as { code?: string; constraint?: string };
    if (e?.code === "23505") return { error: "That workspace address is taken. Try another." };
    return { error: actionError(err) };
  }
  (await cookies()).set(TENANT_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect("/dashboard?welcome=1");
}
