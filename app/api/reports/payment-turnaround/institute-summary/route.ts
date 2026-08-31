import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { computeTurnaroundRows, computeInstituteSummary } from "@/lib/paymentTurnaround";

// GET /api/reports/payment-turnaround/institute-summary?firmCode=&from=&to=
// Institute-wise averages, ranked fastest-paying first.
export async function GET(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db();
    const { searchParams } = new URL(req.url);

    const rows = await computeTurnaroundRows(db, {
      firmCode: searchParams.get("firmCode") || undefined,
      from: searchParams.get("from") || undefined,
      to: searchParams.get("to") || undefined,
    });

    const summary = computeInstituteSummary(rows);
    return NextResponse.json({ count: summary.length, institutes: summary });
  } catch (error: any) {
    console.error("Payment turnaround institute-summary GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to load institute summary" }, { status: 500 });
  }
}
