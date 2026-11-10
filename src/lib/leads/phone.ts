import { env } from "@/lib/env";

/** Normalises a typed phone number to E.164 (+919876543210). Returns null when it can't be one. */
export function toE164(raw: string | null | undefined, countryCode = env.defaultCountryCode()): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  if (trimmed.startsWith("+")) return /^[1-9]\d{6,14}$/.test(digits) ? `+${digits}` : null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = countryCode + digits.replace(/^0+/, "");
  else if (digits.length <= 10) digits = countryCode + digits;
  return /^[1-9]\d{6,14}$/.test(digits) ? `+${digits}` : null;
}
