import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { computeTeamActivity } from "@/lib/teamActivity";

// GET /api/team-performance?range=month|year&firmCode=XXX
// Same underlying signals as the Summary dashboard's "Team Activity — Today"
// table (order status/purchase actions, orders created, GeM Sync uploads +
// completions), aggregated over the current calendar month or year instead
// of just today — powers the Team Performance chart's Monthly/Yearly filter.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const firmCode = searchParams.get("firmCode");
    const range = searchParams.get("range") === "year" ? "year" : "month";

    const client = await clientPromise;
    const db = client.db();

    const now = new Date();
    const start = range === "year" ? new Date(now.getFullYear(), 0, 1) : new Date(now.getFullYear(), now.getMonth(), 1);
    // Exclusive upper bound one day past "now" so today's own activity is included.
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    const teamActivity = await computeTeamActivity(db, { start, end, firmCode });

    return NextResponse.json({ range, rangeStart: start.toISOString(), rangeEnd: end.toISOString(), teamActivity });
  } catch (error: any) {
    console.error("Team performance GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to build team performance" }, { status: 500 });
  }
}
