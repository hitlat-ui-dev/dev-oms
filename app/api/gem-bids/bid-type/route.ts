import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "dev_oms_db";

// POST { bidId, bidType: "regular" | "boq" } — a bid's own choice of which
// kind it is, set from the Bid Rate page's Fill Rates panel. "boq" (the
// default/unset state) means GeM gave a BOQ Detail Document to upload and
// parse, same as this page has always worked. "regular" means the bid was
// built straight off a catalog Item Link with no BOQ file at all - its
// items are typed in by hand instead (see boqRates, which doubles as the
// storage for both kinds - ../boq/route.ts branches on this same field to
// read them back either from a parsed file or as-is).
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { bidId, bidType } = body;
    if (!bidId || !ObjectId.isValid(bidId)) {
      return NextResponse.json({ error: "Valid bidId is required" }, { status: 400 });
    }
    if (bidType !== "regular" && bidType !== "boq") {
      return NextResponse.json({ error: "bidType must be 'regular' or 'boq'" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    await db.collection("gem_bids").updateOne({ _id: new ObjectId(bidId) }, { $set: { bidType, updatedAt: new Date() } });

    return NextResponse.json({ success: true, bidType });
  } catch (error: any) {
    console.error("GeM bid bid-type error:", error);
    return NextResponse.json({ error: error.message || "Failed to set bid type" }, { status: 500 });
  }
}
