import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { computeTurnaroundRows, computeInstituteSummary } from "@/lib/paymentTurnaround";

// GET /api/reports/payment-turnaround/reliability-score?firmCode=&from=&to=
// Same institute computation as institute-summary, but ranked by Payment
// Reliability Score (Speed 40% / Consistency 30% / Pending-ratio 30%)
// instead of raw average turnaround days.
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

    const summary = computeInstituteSummary(rows).sort((a, b) => b.reliabilityScore - a.reliabilityScore);
    return NextResponse.json({ count: summary.length, institutes: summary });
  } catch (error: any) {
    console.error("Payment turnaround reliability-score GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to load reliability scores" }, { status: 500 });
  }
}
