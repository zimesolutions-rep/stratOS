import { env } from "@/lib/env";
import { safeEqual } from "@/lib/inbound/tokens";

/** Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Anything else is refused. */
export function isCronRequest(req: Request): boolean {
  const got = req.headers.get("authorization") ?? "";
  return safeEqual(got, `Bearer ${env.cronSecret()}`);
}
