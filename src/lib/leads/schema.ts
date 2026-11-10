import { z } from "zod";
import { CONSENT_STATUSES, LEAD_SOURCES, LEAD_STATUSES } from "@/lib/stratos/types";
import { toE164 } from "./phone";

const optionalText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));

/** A lead typed in by a rep. Webhook ingestion (Step 2) gets its own per-source normalisers. */
export const leadInput = z.object({
  full_name: optionalText(160),
  email: z.union([z.literal(""), z.email("Enter a valid email")]).optional().transform((v) => (v ? v.toLowerCase() : null)),
  phone: z.string().optional().transform((v, ctx) => {
    if (!v?.trim()) return null;
    const e164 = toE164(v);
    if (!e164) ctx.addIssue({ code: "custom", message: "Enter a valid phone number" });
    return e164;
  }),
  company: optionalText(160),
  job_title: optionalText(120),
  source: z.enum(LEAD_SOURCES).default("manual"),
  stage_id: z.union([z.literal(""), z.uuid()]).optional().transform((v) => v || null),
  contract_value: z.union([z.literal(""), z.coerce.number().nonnegative("Value can't be negative")]).optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  consent_status: z.enum(CONSENT_STATUSES).default("unknown"),
}).refine((v) => v.full_name || v.email || v.phone, { message: "Give at least a name, an email or a phone number" });

export type LeadInput = z.output<typeof leadInput>;

export const leadUpdate = z.object({
  stage_id: z.uuid().optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  consent_status: z.enum(CONSENT_STATUSES).optional(),
});
export type LeadUpdate = z.output<typeof leadUpdate>;
