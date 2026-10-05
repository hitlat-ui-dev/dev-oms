import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "dev_oms_db";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// POST — permanently removes any bid whose 7-day Deleted Bids grace window
// has passed (deletedAt older than 7 days). Fired from app/layout.tsx on
// every site visit, same "site-visit-triggered, idempotent either way"
// pattern as /api/backup/auto and /api/courier/auto - no real cron
// infrastructure in this project, so a plain date-filtered deleteMany is
// naturally idempotent (nothing left to purge twice) rather than needing
// its own "already ran today" guard the way those two do.
//
// The bid's standing tombstone (gem_bid_tombstones, written at delete time)
// is NOT touched here - that's what keeps a purged bid excluded from every
// future sync (see applyImport.ts), and is meant to outlive the purge.
export async function POST() {
  try {
    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const cutoff = new Date(Date.now() - SEVEN_DAYS_MS);

    const result = await db.collection("gem_bids").deleteMany({ deletedAt: { $lte: cutoff } });

    return NextResponse.json({ success: true, purgedCount: result.deletedCount || 0 });
  } catch (error: any) {
    console.error("GeM bids purge-deleted error:", error);
    return NextResponse.json({ error: error.message || "Purge failed" }, { status: 500 });
  }
}
