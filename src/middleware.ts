import { NextResponse, type NextRequest } from "next/server";

// /api/* routes check the session (or a webhook signature / cron secret) themselves; /api/auth is Better Auth.
const PUBLIC_PATHS = ["/login", "/api/"];

/**
 * Optimistic gate: a session cookie must be present to reach portal pages. The cookie is fully
 * verified (and the user looked up) in every page and route handler; this only saves a round trip.
 */
// Better Auth's session cookie (the __Secure- prefix is used on HTTPS).
const SESSION_COOKIES = ["better-auth.session_token", "__Secure-better-auth.session_token"];

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (PUBLIC_PATHS.some((p) => path.startsWith(p)) || path.startsWith("/api/")) return NextResponse.next();
  if (SESSION_COOKIES.some((n) => request.cookies.has(n))) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = path === "/" ? "" : `?next=${encodeURIComponent(path)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ttf|woff2?|txt)$).*)"],
};
