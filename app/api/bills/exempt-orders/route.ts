import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

// POST /api/bills/exempt-orders - marks the given un-billed SellerOrders as
// exempt (won't need a Bill generated for them), for one of two reasons: the
// order was already invoiced outside OMS (e.g. directly in Miracle, before
// this bill feature existed) or it simply doesn't need a bill at all. This
// never touches billId/Bill - it's a separate flag so exempted orders stay
// out of real invoice history/numbering/GST reporting, while still
// disappearing from the "Un-billed Contracts" list the same way an
// actually-billed order would.
//
// Matched by order _id, not contractNo - several orders can share a blank
// contractNo ("No Contract No." in the UI), and matching by that value would
// either exempt every blank-contract order at once or (once empty strings
// get filtered as falsy) match nothing at all.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const firmCode = (body.firmCode || "").toString().trim().toUpperCase();
    const orderIds: string[] = Array.isArray(body.orderIds) ? body.orderIds.filter(Boolean) : [];
    const reason = body.reason;
    const note = (body.note || "").toString().trim();
    const exemptBy = (body.exemptBy || "").toString().trim();

    if (!firmCode || orderIds.length === 0) {
      return NextResponse.json({ error: "firmCode and orderIds are required." }, { status: 400 });
    }
    if (reason !== "ALREADY_BILLED_EXTERNAL" && reason !== "NOT_REQUIRED") {
      return NextResponse.json({ error: "reason must be ALREADY_BILLED_EXTERNAL or NOT_REQUIRED." }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db();

    // Only touch orders that are actually still pending a bill - never
    // exempt something that's already been through the real Generate Bill flow.
    const result = await db.collection("sellerorders").updateMany(
      { _id: { $in: orderIds.map((id) => new ObjectId(id)) }, firmCode, billId: null },
      {
        $set: {
          billExempt: true,
          billExemptReason: reason,
          billExemptNote: note,
          billExemptAt: new Date(),
          billExemptBy: exemptBy,
        },
      }
    );

    return NextResponse.json({ success: true, matched: result.matchedCount, modified: result.modifiedCount });
  } catch (error: any) {
    console.error("POST exempt-orders error:", error);
    return NextResponse.json({ error: error.message || "Failed to exempt orders" }, { status: 500 });
  }
}

// DELETE /api/bills/exempt-orders - undoes an exemption, putting the
// order(s) back into the "Un-billed Contracts" list.
export async function DELETE(req: Request) {
  try {
    const body = await req.json();
    const firmCode = (body.firmCode || "").toString().trim().toUpperCase();
    const orderIds: string[] = Array.isArray(body.orderIds) ? body.orderIds.filter(Boolean) : [];

    if (!firmCode || orderIds.length === 0) {
      return NextResponse.json({ error: "firmCode and orderIds are required." }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db();

    const result = await db.collection("sellerorders").updateMany(
      { _id: { $in: orderIds.map((id) => new ObjectId(id)) }, firmCode, billExempt: true },
      {
        $set: { billExempt: false },
        $unset: { billExemptReason: "", billExemptNote: "", billExemptAt: "", billExemptBy: "" },
      }
    );

    return NextResponse.json({ success: true, matched: result.matchedCount, modified: result.modifiedCount });
  } catch (error: any) {
    console.error("DELETE exempt-orders error:", error);
    return NextResponse.json({ error: error.message || "Failed to un-exempt orders" }, { status: 500 });
  }
}
