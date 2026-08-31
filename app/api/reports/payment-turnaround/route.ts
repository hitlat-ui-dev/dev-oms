import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { computeTurnaroundRows } from "@/lib/paymentTurnaround";

// GET /api/reports/payment-turnaround?firmCode=&instituteName=&from=&to=&status=Paid|Pending|All
// Per-bill turnaround table: Bill Date -> Delivery Date -> Payment Date, with
// days-elapsed for each leg. A bill with no confirmed payment yet always
// comes back with paymentDate=null and status="Pending", never excluded.
export async function GET(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db();
    const { searchParams } = new URL(req.url);

    const rows = await computeTurnaroundRows(db, {
      firmCode: searchParams.get("firmCode") || undefined,
      instituteName: searchParams.get("instituteName") || undefined,
      from: searchParams.get("from") || undefined,
      to: searchParams.get("to") || undefined,
      status: (searchParams.get("status") as "Paid" | "Pending" | "All") || "All",
    });

    return NextResponse.json({ count: rows.length, rows });
  } catch (error: any) {
    console.error("Payment turnaround GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to load payment turnaround report" }, { status: 500 });
  }
}
