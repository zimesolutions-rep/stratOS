import { NextResponse } from "next/server";
import { isCronRequest } from "@/lib/cron/auth";
import { asService } from "@/lib/db";
import { decayInactiveLeads } from "@/lib/scoring/score";

export const maxDuration = 60;

/** GET /api/cron/decay — daily at 06:00 IST (vercel.json; daily also works on the Vercel Hobby plan). Lowers the
 * score of leads idle for 48 hours, at most once per 48 hours each, in batches of 500. */
export async function GET(req: Request) {
  if (!isCronRequest(req)) return NextResponse.json({ ok: false, error: { code: "forbidden", message: "Cron only" } }, { status: 401 });
  let total = 0;
  for (let i = 0; i < 10; i++) {
    const n = await asService((db) => decayInactiveLeads(db, 500));
    total += n;
    if (n < 500) break;
  }
  return NextResponse.json({ ok: true, data: { decayed: total } });
}
