import { z } from "zod";
import { CONSENT_STATUSES, LEAD_SOURCES, LEAD_STATUSES } from "@/lib/stratos/types";
import { toE164 } from "./phone";

const optionalText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));

const contactFields = {
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
  contract_value: z.union([z.literal(""), z.coerce.number().nonnegative("Value can't be negative")]).optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
};
const hasContact = (v: { full_name: string | null; email: string | null; phone: string | null }) =>
  Boolean(v.full_name || v.email || v.phone);
const contactMessage = { message: "Give at least a name, an email or a phone number" };

/** A lead typed in by a rep. Webhook ingestion (Step 2) gets its own per-source normalisers. */
export const leadInput = z.object({
  ...contactFields,
  source: z.enum(LEAD_SOURCES).default("manual"),
  stage_id: z.union([z.literal(""), z.uuid()]).optional().transform((v) => v || null),
  consent_status: z.enum(CONSENT_STATUSES).default("unknown"),
}).refine(hasContact, contactMessage);

export type LeadInput = z.output<typeof leadInput>;

export const leadUpdate = z.object({
  stage_id: z.uuid().optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  consent_status: z.enum(CONSENT_STATUSES).optional(),
});
export type LeadUpdate = z.output<typeof leadUpdate>;

/** Editing a saved lead's contact details. Every field is sent; a blank one clears it. */
export const leadDetails = z.object(contactFields).refine(hasContact, contactMessage);
export type LeadDetails = z.output<typeof leadDetails>;
