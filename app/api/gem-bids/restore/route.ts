import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "dev_oms_db";

// POST { bidNos: string[], kind?: "deleted" | "expired" } — undoes a
// soft-delete (clears deletedAt) or an auto-expiry (clears expiredAt) while
// a bid is still inside its 7-day holding window. kind defaults to
// "deleted" for backward compatibility with any existing caller that
// doesn't send it. Does not touch a standing delete tombstone (see
// /api/gem-bids DELETE) - that's a separate record of "this bid was
// deleted once," not undone by a restore, so a later delete-then-resync
// still compares against the original delete snapshot. Expired Bids has
// no tombstone to begin with (see expireBidsJob.ts), so restoring one is
// unconditional.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { bidNos, kind } = body;
    if (!Array.isArray(bidNos) || bidNos.length === 0) {
      return NextResponse.json({ error: "bidNos are required" }, { status: 400 });
    }
    const field = kind === "expired" ? "expiredAt" : "deletedAt";

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const result = await db
      .collection("gem_bids")
      .updateMany({ bidNo: { $in: bidNos } }, { $unset: { [field]: "" } });

    return NextResponse.json({ success: true, restoredCount: result.modifiedCount || 0 });
  } catch (error: any) {
    console.error("GeM bids restore error:", error);
    return NextResponse.json({ error: error.message || "Restore failed" }, { status: 500 });
  }
}
