import { NextRequest, NextResponse } from "next/server";
import { toRequestUrl } from "@/lib/request-url";
import { sessionOptions } from "@/lib/session";

const PUBLIC_PREFIXES = ["/login", "/invite", "/icons"];
const PUBLIC_ASSETS = [
  "/manifest.webmanifest",
  "/sw.js",
  "/api/push/receipt",
  // Auth is checked inside the route itself so an unauthenticated POST (from
  // the OS share sheet) gets a proper redirect instead of a 307-preserved
  // POST to the /login page.
  "/api/share-target",
  "/icon.jpeg",
  "/apple-icon.jpeg",
  "/logo.jpeg",
];

/**
 * Lightweight gate: only checks for the presence of the session cookie.
 * The actual session is validated by layouts, server actions and route handlers.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
  const isPublicAsset = PUBLIC_ASSETS.includes(pathname);
  const hasSessionCookie = req.cookies.has(sessionOptions.cookieName);

  if (!hasSessionCookie && !isPublic && !isPublicAsset) {
    const loginUrl = toRequestUrl(req, "/login");
    const returnPath = `${pathname}${req.nextUrl.search}`.slice(0, 512);
    loginUrl.searchParams.set("next", returnPath);
    return NextResponse.redirect(loginUrl);
  }
  if (hasSessionCookie && pathname === "/login") {
    return NextResponse.redirect(toRequestUrl(req, "/"));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
