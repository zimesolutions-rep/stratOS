import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth/server";

/** Better Auth endpoints (magic-link send/verify, session, sign-out). */
export async function GET(req: Request) {
  return toNextJsHandler(auth()).GET(req);
}
export async function POST(req: Request) {
  return toNextJsHandler(auth()).POST(req);
}
