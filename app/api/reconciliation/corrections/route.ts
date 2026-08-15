import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

// GET: list correction alerts raised by the leftover-entry recheck (Addition 4).
// Defaults to pending ones — the reconciliation page's Correction Alerts panel.
export async function GET(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db();

    const { searchParams } = new URL(req.url);
    const firmCode = searchParams.get("firmCode");
    const status = searchParams.get("status") || "pending";

    const filter: any = { status };
    if (firmCode) filter.firmCode = firmCode;

    const alerts = await db
      .collection("reconciliation_correction_alerts")
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    return NextResponse.json(alerts);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to load correction alerts" }, { status: 500 });
  }
}
