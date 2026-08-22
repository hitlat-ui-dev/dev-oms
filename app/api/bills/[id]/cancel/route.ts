import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import mongoose from "mongoose";
import { cancelSellerOrder } from "@/lib/cancelSellerOrder";

// POST /api/bills/[id]/cancel - cancels every seller order this bill was
// generated from (restoring stock as needed) and tags the bill itself as
// cancelled. The bill record is kept, not deleted, for the accounting trail.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid bill id" }, { status: 400 });
    }

    const { userName } = await req.json().catch(() => ({}));

    const client = await clientPromise;
    const db = client.db();

    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(process.env.MONGODB_URI as string);
    }

    const bill = await db.collection("bills").findOne({ _id: new ObjectId(id) });
    if (!bill) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    }
    if (bill.cancelled) {
      return NextResponse.json({ error: "This bill is already cancelled." }, { status: 400 });
    }

    const sellerOrderIds = (bill.items || []).map((it: any) => it.sellerOrderId).filter(Boolean);

    for (const orderId of sellerOrderIds) {
      try {
        await cancelSellerOrder(db, orderId, userName);
      } catch (err: any) {
        console.error(`[BILL CANCEL] Failed to cancel order ${orderId}:`, err.message);
        // Keep going - one order failing (e.g. concurrent edit) shouldn't
        // block the rest from being cancelled, and the bill still gets
        // tagged so the mismatch is at least visible.
      }
    }

    await db.collection("bills").updateOne(
      { _id: new ObjectId(id) },
      { $set: { cancelled: true, cancelledAt: new Date(), cancelledBy: userName || "Admin" } }
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Bill cancel error:", error);
    return NextResponse.json({ error: error.message || "Cancel failed" }, { status: 500 });
  }
}
