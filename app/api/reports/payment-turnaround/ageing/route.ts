import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { computeTurnaroundRows, computeAgeing } from "@/lib/paymentTurnaround";

// GET /api/reports/payment-turnaround/ageing?firmCode=&ageFrom=deliveryDate|billDate
// Ageing buckets (0-30/31-60/61-90/90+) for still-unpaid bills, with a
// per-institute breakdown inside each bucket.
export async function GET(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db();
    const { searchParams } = new URL(req.url);
    const ageFrom = searchParams.get("ageFrom") === "billDate" ? "billDate" : "deliveryDate";

    const rows = await computeTurnaroundRows(db, {
      firmCode: searchParams.get("firmCode") || undefined,
      status: "Pending",
    });

    const result = computeAgeing(rows, ageFrom);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Payment turnaround ageing GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to load ageing report" }, { status: 500 });
  }
}
