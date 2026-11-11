import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** A new endpoint token, shown to the admin once. Only its SHA-256 is stored. */
export function newToken(): string {
  return `st_${randomBytes(24).toString("base64url")}`;
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Constant-time string compare. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Meta signs the raw body: X-Hub-Signature-256: sha256=<hex HMAC with the app secret>. */
export function verifyMetaSignature(raw: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(raw, "utf8").digest("hex")}`;
  return safeEqual(header, expected);
}
