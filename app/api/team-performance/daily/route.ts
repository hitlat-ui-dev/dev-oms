import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { computeTeamActivityByBucket } from "@/lib/teamActivity";

// GET /api/team-performance/daily?username=X&range=month|year&firmCode=XXX
// One team member's activity trend - day-by-day for the current month, or
// month-by-month for the current year (day-level granularity across a whole
// year would be ~365 unreadable bars). Every bucket in range is returned
// even with zero activity, so the chart shows a continuous timeline.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const username = searchParams.get("username");
    if (!username) {
      return NextResponse.json({ error: "username is required" }, { status: 400 });
    }
    const firmCode = searchParams.get("firmCode");
    const range = searchParams.get("range") === "year" ? "year" : "month";
    const bucketBy: "day" | "month" = range === "year" ? "month" : "day";

    const client = await clientPromise;
    const db = client.db();

    const now = new Date();
    const start = range === "year" ? new Date(now.getFullYear(), 0, 1) : new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    const rows = await computeTeamActivityByBucket(db, { start, end, firmCode, bucketBy });
    const byBucket = new Map(rows.filter((r) => r.username === username).map((r) => [r.bucket, r]));

    const buckets: string[] = [];
    if (bucketBy === "day") {
      for (let d = new Date(start); d < end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
        buckets.push(
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
        );
      }
    } else {
      for (let m = 0; m <= now.getMonth(); m++) {
        buckets.push(`${now.getFullYear()}-${String(m + 1).padStart(2, "0")}`);
      }
    }

    const series = buckets.map((bucket) => {
      const row = byBucket.get(bucket);
      return {
        bucket,
        totalActions: row?.totalActions || 0,
        ordersCreated: row?.ordersCreated || 0,
        ordersCreatedQty: row?.ordersCreatedQty || 0,
        filesUploaded: row?.filesUploaded || 0,
        productsCompleted: row?.productsCompleted || 0,
        actions: row?.actions || {},
      };
    });

    return NextResponse.json({ username, range, bucketBy, series });
  } catch (error: any) {
    console.error("Team performance daily GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to build daily team performance" }, { status: 500 });
  }
}
