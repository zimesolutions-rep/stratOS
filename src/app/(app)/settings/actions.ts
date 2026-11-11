"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ApiError, actionError } from "@/lib/api";
import { env } from "@/lib/env";
import { hashToken, newToken } from "@/lib/inbound/tokens";
import { requireMember } from "@/lib/tenant";

export type SourceFormState = {
  error?: string;
  /** Shown once, right after creation. */
  created?: { source: string; url: string; token: string | null };
};

const endpointInput = z.object({
  source: z.enum(["website_form", "google_ads_lead_form", "facebook_lead_ads"]),
  label: z.string().trim().max(80).optional().transform((v) => v || null),
  page_id: z.string().trim().optional().transform((v) => v || null),
  cadence_key: z.string().trim().optional().transform((v) => v || null),
}).superRefine((v, ctx) => {
  if (v.source === "facebook_lead_ads" && !/^\d{5,30}$/.test(v.page_id ?? "")) {
    ctx.addIssue({ code: "custom", message: "Enter the Facebook page id (digits only, from the page's About > Page transparency)" });
  }
});

/** Creates an inbound endpoint. Its token is shown once; only the hash is stored. */
export async function createEndpoint(_prev: SourceFormState, form: FormData): Promise<SourceFormState> {
  try {
    const me = await requireMember({ admin: true });
    const v = endpointInput.parse(Object.fromEntries(form));
    const token = newToken();
    const config: Record<string, string> = {};
    if (v.source === "facebook_lead_ads" && v.page_id) config.page_id = v.page_id;
    if (v.cadence_key) config.cadence_key = v.cadence_key;
    await me.db(async (db) => {
      if (v.cadence_key) {
        const ok = (await db.query("select 1 from stratos.cadences where key = $1", [v.cadence_key])).rowCount;
        if (!ok) throw new ApiError(422, "invalid_cadence", "Pick a cadence from the list");
      }
      await db.query(
        `insert into stratos.inbound_endpoints (source, token_hash, token_prefix, label, config)
         values ($1, $2, $3, $4, $5)`, [v.source, hashToken(token), token.slice(0, 7), v.label, config]);
    });
    revalidatePath("/settings/sources");
    const base = `${env.siteUrl().replace(/\/$/, "")}/api/v1/webhooks/inbound`;
    return {
      created: v.source === "website_form"
        ? { source: v.source, url: `${base}/website?t=${token}`, token }
        : v.source === "google_ads_lead_form"
          ? { source: v.source, url: `${base}/google`, token }
          : { source: v.source, url: `${base}/meta`, token: null },
    };
  } catch (err) {
    if ((err as { code?: string }).code === "23505") return { error: "That Facebook page is already connected to a workspace." };
    return { error: actionError(err) };
  }
}

export async function setEndpointActive(id: string, active: boolean): Promise<void> {
  if (!z.uuid().safeParse(id).success) return;
  const me = await requireMember({ admin: true });
  await me.db((db) => db.query("update stratos.inbound_endpoints set active = $2 where id = $1", [id, active]));
  revalidatePath("/settings/sources");
}

export type ScoringState = { error?: string; saved?: boolean };

/** Saves scoring weights. Starting scores are 0 to 100; other rules move a score by -100 to +100 points. */
export async function saveScoring(_prev: ScoringState, form: FormData): Promise<ScoringState> {
  try {
    const me = await requireMember({ admin: true });
    const rows = [...form.entries()]
      .filter(([k]) => k.startsWith("rule:"))
      .map(([k, v]) => {
        const key = k.slice(5);
        const n = Number(v);
        const min = key.startsWith("source:") ? 0 : -100;
        if (!/^[a-z0-9_:]+$/.test(key) || !Number.isFinite(n) || n < min || n > 100) {
          throw new ApiError(422, "invalid_value", `${key.replace(/_/g, " ")}: use a number from ${min} to 100`);
        }
        return [key, n] as const;
      });
    await me.db(async (db) => {
      for (const [key, value] of rows) {
        await db.query("update stratos.scoring_rules set value = $2 where rule_key = $1", [key, value]);
      }
    });
    revalidatePath("/settings/scoring");
    return { saved: true };
  } catch (err) {
    return { error: actionError(err) };
  }
}
