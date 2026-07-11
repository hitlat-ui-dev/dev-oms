import clientPromise from "@/lib/mongodb";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();
    const usernameLower = username?.toLowerCase();

    // Check for hardcoded fallback/static admin login
    if (
      (usernameLower === "admin" || usernameLower === "chintan" || usernameLower === "hitesh") &&
      password === "this.admin"
    ) {
      return NextResponse.json({
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
    }

    const client = await clientPromise;
    const db = client.db("dev_oms_db");

    // Search for the user in your 'users' folder
    const user = await db.collection("users").findOne({ username, password });

    if (!user) {
      return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
    }

    return NextResponse.json({
      success: true,
      username: user.username,
      permissions: user.permissions,
    });
  } catch (error) {
    return NextResponse.json({ error: "Database connection failed" }, { status: 500 });
  }
}