import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

// POST: Bulk-disable selected intake rows. Soft flag, not a delete - the row
// (and its contractNo) stays in gem_order_intake forever so the POST /
// duplicate check in ../route.ts keeps rejecting it if the extension scrapes
// the same contract again later.
export async function POST(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");
    const body = await req.json();

    const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: "No orders selected" }, { status: 400, headers: corsHeaders });
    }

    const objectIds = ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
    const result = await db.collection("gem_order_intake").updateMany(
      { _id: { $in: objectIds } },
      { $set: { disabled: true, disabledAt: new Date() } }
    );

    return NextResponse.json({ success: true, disabled: result.modifiedCount }, { status: 200, headers: corsHeaders });
  } catch (error: any) {
    console.error("Bulk disable intake error:", error);
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}
