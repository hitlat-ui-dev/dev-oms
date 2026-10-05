import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "dev_oms_db";

// POST { bidNos: string[] } — undoes a soft-delete (clears deletedAt) while
// a bid is still inside its 7-day Deleted Bids window. Does not touch its
// standing tombstone (see /api/gem-bids DELETE) - that's a separate record
// of "this bid was deleted once," not undone by a restore, so a later
// delete-then-resync still compares against the original delete snapshot.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { bidNos } = body;
    if (!Array.isArray(bidNos) || bidNos.length === 0) {
      return NextResponse.json({ error: "bidNos are required" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const result = await db
      .collection("gem_bids")
      .updateMany({ bidNo: { $in: bidNos } }, { $unset: { deletedAt: "" } });

    return NextResponse.json({ success: true, restoredCount: result.modifiedCount || 0 });
  } catch (error: any) {
    console.error("GeM bids restore error:", error);
    return NextResponse.json({ error: error.message || "Restore failed" }, { status: 500 });
  }
}
