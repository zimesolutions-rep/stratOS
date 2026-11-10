/**
 * PII / PHI masking for StratOS. Run every string through maskText() (or every payload through maskDeep())
 * before it is logged, sent to an AI endpoint (Groq, Deepinfra, OpenAI) or stored in ai_tool_calls.
 *
 * Two modes:
 *   - "redact": replaces matches with typed placeholders ([EMAIL_1], [PHONE_1], ...). Use for logs.
 *   - "tokenize": same placeholders, but returns a vault so the server can restore real values in the
 *     model's answer (unmaskText). Use for AI calls, so the model never sees the real values.
 *
 * Patterns cover India (DPDP: Aadhaar, PAN, Indian mobiles, UPI ids), the EU (GDPR: IBAN, emails, phones) and the
 * US (HIPAA identifiers: SSN, MRN-style ids, dates of birth). Names are masked when the caller passes them as
 * known values (the lead's own name, company), because free-text name detection is unreliable.
 */

export type PiiKind =
  | "EMAIL" | "PHONE" | "AADHAAR" | "PAN" | "SSN" | "IBAN" | "CARD" | "UPI" | "IP" | "DOB" | "MRN" | "NAME" | "URL_TOKEN";

export type MaskOptions = {
  /** Exact values to mask wherever they appear, e.g. the lead's name and company. */
  known?: { kind: PiiKind; value: string | null | undefined }[];
  /** HIPAA tenants or leads flagged contains_phi: also mask dates and medical record numbers. */
  strict?: boolean;
};

export type MaskResult = { text: string; vault: Map<string, string> };

// Order matters: specific patterns first so a card number is not half-eaten by the phone pattern.
const PATTERNS: { kind: PiiKind; re: RegExp; strictOnly?: boolean; valid?: (m: string) => boolean }[] = [
  { kind: "EMAIL", re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  { kind: "URL_TOKEN", re: /([?&](?:token|key|sig|signature|access_token|auth)=)[^&\s]+/gi },
  { kind: "UPI", re: /\b[a-z0-9.\-_]{2,256}@(?:ok)?(?:axis|hdfc|icici|sbi|ybl|paytm|upi|apl|ibl|axl)\b/gi },
  { kind: "IBAN", re: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g },
  { kind: "CARD", re: /\b(?:\d[ -]?){13,19}\b/g, valid: luhn },
  { kind: "AADHAAR", re: /\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g },
  { kind: "PAN", re: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
  { kind: "SSN", re: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g },
  { kind: "PHONE", re: /(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s-]?)?\d{3,5}[\s-]?\d{4,5}\b/g, valid: (m) => m.replace(/\D/g, "").length >= 8 },
  { kind: "IP", re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
  { kind: "DOB", re: /\b(?:\d{1,2}[\/.-]\d{1,2}[\/.-](?:19|20)\d{2}|(?:19|20)\d{2}-\d{2}-\d{2})\b/g, strictOnly: true },
  { kind: "MRN", re: /\b(?:MRN|UHID|Patient\s*ID)[:#\s]*[A-Z0-9-]{4,}\b/gi, strictOnly: true },
];

function luhn(m: string): boolean {
  const digits = m.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Masks text. The vault maps each placeholder to its original value (keep it server-side, never log it). */
export function maskText(input: string, opts: MaskOptions = {}): MaskResult {
  const vault = new Map<string, string>();
  const byValue = new Map<string, string>();
  const counters = new Map<PiiKind, number>();
  const placeholder = (kind: PiiKind, original: string) => {
    const existing = byValue.get(`${kind}:${original}`);
    if (existing) return existing;
    const n = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, n);
    const p = `[${kind}_${n}]`;
    vault.set(p, original);
    byValue.set(`${kind}:${original}`, p);
    return p;
  };

  let text = input;
  for (const k of opts.known ?? []) {
    const v = k.value?.trim();
    if (!v || v.length < 2) continue;
    text = text.replace(new RegExp(`\\b${escapeRe(v)}\\b`, "gi"), (m) => placeholder(k.kind, m));
  }
  for (const p of PATTERNS) {
    if (p.strictOnly && !opts.strict) continue;
    text = text.replace(p.re, (m, prefix?: string) => {
      if (p.kind === "URL_TOKEN" && typeof prefix === "string") return `${prefix}${placeholder("URL_TOKEN", m.slice(prefix.length))}`;
      if (/^\[[A-Z_]+_\d+\]$/.test(m)) return m;
      if (p.valid && !p.valid(m)) return m;
      return placeholder(p.kind, m);
    });
  }
  return { text, vault };
}

/** Puts real values back into a model's answer (only for display to the signed-in rep, never into logs). */
export function unmaskText(text: string, vault: Map<string, string>): string {
  return text.replace(/\[[A-Z_]+_\d+\]/g, (p) => vault.get(p) ?? p);
}

/** Redacts every string inside an object (for logs and ai_tool_calls.args). Keys named like PII are dropped. */
export function maskDeep<T>(value: T, opts: MaskOptions = {}): T {
  const SENSITIVE_KEYS = /^(email|phone|mobile|full_name|name|address|aadhaar|pan|ssn|dob|password|token|secret|api_key)$/i;
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === "string") return key && SENSITIVE_KEYS.test(key) ? "[REDACTED]" : maskText(v, opts).text;
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    return v;
  };
  return walk(value) as T;
}

/** console wrapper that masks before anything reaches Vercel logs. */
export const safeLog = {
  info: (msg: string, data?: unknown) => console.log(msg, data === undefined ? "" : maskDeep(data)),
  warn: (msg: string, data?: unknown) => console.warn(msg, data === undefined ? "" : maskDeep(data)),
  error: (msg: string, data?: unknown) => console.error(msg, data === undefined ? "" : maskDeep(data)),
};
