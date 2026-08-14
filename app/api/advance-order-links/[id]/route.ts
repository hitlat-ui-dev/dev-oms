import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

const DB_NAME = "dev_oms_db";

// DELETE: unlink a mistaken link. Pure delete of the ledger row — no SellerOrder field
// was ever touched by creating a link, so there's nothing else to unwind here.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid link id" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const result = await db.collection("advance_order_links").deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "Link not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("advance-order-links DELETE error:", error);
    return NextResponse.json({ error: error.message || "Failed to delete link" }, { status: 500 });
  }
}
