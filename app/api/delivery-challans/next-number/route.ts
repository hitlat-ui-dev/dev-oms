import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import {
  formatDcNumber,
  getFinancialYear,
  readLastDcNumber,
  shortFinancialYear,
} from "@/lib/dcNumbering";
import { parseFormDate } from "@/lib/deliveryChallan";

// GET /api/delivery-challans/next-number?firmCode=XX&date=yyyy-mm-dd
//
// Header preview only - it READS the counter without consuming it. The number
// actually printed is claimed at finalize, so what this returns is provisional:
// if someone else finalizes a challan for the same firm first, the next one
// moves on. The screen labels it as such rather than presenting it as booked.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const firmCode = (searchParams.get("firmCode") || "").trim().toUpperCase();
    const dateParam = (searchParams.get("date") || "").trim();

    const date = dateParam ? parseFormDate(dateParam) : new Date();
    if (!date) {
      return NextResponse.json({ error: "Invalid date." }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db();

    // No firmCode is legitimate - the challan just draws from the shared
    // no-firm series rather than a firm's own.
    if (firmCode && !(await db.collection("companies").findOne({ firmCode }))) {
      return NextResponse.json({ error: "Firm not found." }, { status: 404 });
    }

    // The challan's own date decides the FY, so a back-dated challan previews
    // the previous year's series rather than today's.
    const fy = getFinancialYear(date);
    const shortFy = shortFinancialYear(fy);
    const nextSequence = (await readLastDcNumber(db, firmCode, fy)) + 1;

    return NextResponse.json({
      success: true,
      financialYear: shortFy,
      nextSequence,
      dcNumberFormatted: formatDcNumber(nextSequence, shortFy),
      lastUsed: nextSequence - 1,
    });
  } catch (error: any) {
    console.error("GET delivery-challans/next-number error:", error);
    return NextResponse.json({ error: error.message || "Failed to read next DC number" }, { status: 500 });
  }
}
