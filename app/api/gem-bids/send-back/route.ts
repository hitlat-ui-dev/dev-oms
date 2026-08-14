import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "dev_oms_db";

// PATCH: undo each bid's most recent move only (one hop per click), independently per bid
// in a multi-select. This is a convenience wrapper around the same move mechanic — the
// reversal itself is logged as a new gem_bid_move_history entry (isReversal:true), never
// deleting the original mistaken move, so the audit trail shows both.
export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { bidNos, movedBy } = body;

    if (!Array.isArray(bidNos) || bidNos.length === 0) {
      return NextResponse.json({ error: "bidNos are required" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const bidsCollection = db.collection("gem_bids");
    const moveHistoryCollection = db.collection("gem_bid_move_history");

    const movedAt = new Date();
    const results: { bidNo: string; movedTo?: string; skipped?: boolean }[] = [];

    for (const bidNo of bidNos) {
      const bid = await bidsCollection.findOne({ bidNo });
      const stack: string[] = Array.isArray(bid?.sectionStack) ? bid.sectionStack : [];
      if (!bid || bid.currentSection === "fetched_bid_data" || stack.length === 0) {
        results.push({ bidNo, skipped: true });
        continue;
      }

      // The top of the stack is exactly where the most recent forward move came FROM —
      // popping it (not re-reading the log) is what makes repeated clicks step back one
      // genuine hop at a time. See the comment in move/route.ts for why the log alone can't do this.
      const target = stack[stack.length - 1];
      await bidsCollection.updateOne(
        { bidNo },
        { $set: { currentSection: target, updatedAt: movedAt }, $pop: { sectionStack: 1 } }
      );
      await moveHistoryCollection.insertOne({
        bidNo,
        fromSection: bid.currentSection,
        toSection: target,
        movedBy: movedBy || "",
        movedAt,
        isReversal: true,
      });
      results.push({ bidNo, movedTo: target });
    }

    return NextResponse.json({ success: true, results });
  } catch (error: any) {
    console.error("GeM bid send-back error:", error);
    return NextResponse.json({ error: error.message || "Send back failed" }, { status: 500 });
  }
}
