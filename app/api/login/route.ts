import clientPromise from "@/lib/mongodb";
import { NextResponse } from "next/server";
import { signSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";

async function withSessionCookie(res: NextResponse, username: string) {
  const token = await signSessionToken(username);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12, // 12h, matches signSessionToken's expiry
  });
  return res;
}

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();
    const usernameLower = username?.toLowerCase();

    // Check for hardcoded fallback/static admin login
    if (
      (usernameLower === "admin" || usernameLower === "chintan" || usernameLower === "hitesh") &&
      verifyPassword(password, process.env.ADMIN_PASSWORD_HASH)
    ) {
      const res = NextResponse.json({
        success: true,
        username: username,
        permissions: {
          boss: true,
          purchase: true,
          stock: true,
          manageStock: true,
          users: true,
          backup: true,
          addSeller: true,
          purchaseReq: true,
          addOrder: true,
          addTransporter: true,
          addMyCompanies: true,
          addNewItem: true,
          addVendor: true,
          receivePurchaseRate: true,
          stockLastRate: true,
          printLabels: true,
          hideStockItem: true,
        },
      });
      return withSessionCookie(res, username);
    }

    const client = await clientPromise;
    const db = client.db("dev_oms_db");

    // Search for the user in your 'users' folder
    const user = await db.collection("users").findOne({ username });

    if (!user || !verifyPassword(password, user.password)) {
      return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
    }

    const res = NextResponse.json({
      success: true,
      username: user.username,
      permissions: user.permissions,
    });
    return withSessionCookie(res, user.username);
  } catch (error: any) {
    console.error("Database connection error details:", error);
    return NextResponse.json({ error: "Database connection failed", details: error.message }, { status: 500 });
  }
}