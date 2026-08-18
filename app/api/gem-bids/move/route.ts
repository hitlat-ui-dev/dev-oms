import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { SECTION_KEYS } from "@/lib/gemBids/columns";

const DB_NAME = "dev_oms_db";

// PATCH: move one or more bids to a target section — never a copy, a bid lives in exactly
// one section at a time. Every move (any direction) is recorded in gem_bid_move_history.
export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { bidNos, toSection, movedBy } = body;

    if (!Array.isArray(bidNos) || bidNos.length === 0 || !SECTION_KEYS.includes(toSection)) {
      return NextResponse.json({ error: "bidNos and a valid toSection are required" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const bidsCollection = db.collection("gem_bids");
    const moveHistoryCollection = db.collection("gem_bid_move_history");

    const movedAt = new Date();
    const moveHistoryDocs: any[] = [];
    let movedCount = 0;

    for (const bidNo of bidNos) {
      const bid = await bidsCollection.findOne({ bidNo });
      if (!bid || bid.currentSection === toSection) continue;

      // Push the section we're leaving onto this bid's undo stack — Send Back pops it,
      // which is what makes repeated Send Back clicks walk back one genuine hop at a time
      // instead of just looking at the last log row (which, after one reversal, would be
      // the reversal itself and cause it to bounce between two sections).
      const setDoc: Record<string, any> = { currentSection: toSection, updatedAt: movedAt };
      // Arriving fresh at Submitted Bids starts life as "Active" until the next
      // sync's portal status check (or a manual edit) says otherwise.
      if (toSection === "submitted_bids" && !bid.submittedStatus) {
        setDoc.submittedStatus = "Active";
      }
      await bidsCollection.updateOne(
        { bidNo },
        { $set: setDoc, $push: { sectionStack: bid.currentSection } }
      );
      moveHistoryDocs.push({
        bidNo,
        fromSection: bid.currentSection,
        toSection,
        movedBy: movedBy || "",
        movedAt,
        isReversal: false,
      });
      movedCount++;
    }

    if (moveHistoryDocs.length > 0) {
      await moveHistoryCollection.insertMany(moveHistoryDocs);
    }

    return NextResponse.json({ success: true, movedCount });
  } catch (error: any) {
    console.error("GeM bid move error:", error);
    return NextResponse.json({ error: error.message || "Move failed" }, { status: 500 });
  }
}
