import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

// GET /api/gem-orders/fetch-history - per-firm "when was this firm's GeM
// orders last fetched" log, for every firm (not just ones with a log entry
// yet), sorted most-recently-fetched first - firms never fetched (or not
// fetched in a long time) sink to the bottom.
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db();

    const [companies, logs] = await Promise.all([
      db.collection("companies").find({}, { projection: { firmCode: 1, firmName: 1 } }).toArray(),
      db.collection("gem_order_fetch_log").find({}).toArray(),
    ]);

    const lastFetchedByFirm = new Map(logs.map((l: any) => [l.firmCode, l.lastFetchedAt]));

    const history = companies.map((c: any) => ({
      firmCode: c.firmCode,
      firmName: c.firmName,
      lastFetchedAt: lastFetchedByFirm.get(c.firmCode) || null,
    }));

    history.sort((a, b) => {
      if (!a.lastFetchedAt && !b.lastFetchedAt) return a.firmName.localeCompare(b.firmName);
      if (!a.lastFetchedAt) return 1; // never-fetched firms sink to the bottom
      if (!b.lastFetchedAt) return -1;
      return new Date(b.lastFetchedAt).getTime() - new Date(a.lastFetchedAt).getTime();
    });

    return NextResponse.json(history);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch history" }, { status: 500 });
  }
}
