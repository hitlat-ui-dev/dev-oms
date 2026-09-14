import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";

// API routes that authenticate themselves a different way (a shared secret
// header, checked in the route itself) instead of the browser session
// cookie - e.g. the local whatsapp-bridge/ service polling these with no
// browser involved at all. Everything else under /api requires a session.
const SESSION_EXEMPT_API_PREFIXES = [
  "/api/login",
  "/api/logout",
  "/api/session",
  "/api/whatsapp-bridge/status",
  "/api/delivery-challan/mark-whatsapp-sent",
  "/api/delivery-challan/pending-whatsapp",
  "/api/courier/pending-whatsapp",
  "/api/courier/mark-whatsapp-sent",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (isApi && SESSION_EXEMPT_API_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (session) {
    return NextResponse.next();
  }

  if (isApi) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", req.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
};
