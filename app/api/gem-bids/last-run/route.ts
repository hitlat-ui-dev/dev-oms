import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "dev_oms_db";

// GET: the most recent completed import/apply run — feeds the dashboard panel's
// "excluded / auto-deleted / last sync" numbers (gem_bid_runs, populated by
// lib/gemBids/applyImport.ts on every import, not the live-progress
// gem_bid_sync_runs collection which is a separate concern).
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const run = await db.collection("gem_bid_runs").findOne({}, { sort: { runAt: -1 } });
    return NextResponse.json(run || null);
  } catch (error: any) {
    console.error("GeM bid last-run error:", error);
    return NextResponse.json({ error: error.message || "Failed to load last run" }, { status: 500 });
  }
}
