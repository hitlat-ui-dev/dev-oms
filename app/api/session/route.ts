import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";

// Lets client components check the real (httpOnly, server-verified) session
// instead of trusting localStorage's "oms_user" flag, which can go stale -
// e.g. the cookie expires after 12h but localStorage still says logged in,
// which would otherwise bounce /login <-> /dashboard forever against
// middleware.ts.
export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;
  return NextResponse.json({ loggedIn: !!session });
}
