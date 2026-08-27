import { NextResponse } from "next/server";
import dbConnect from "@/lib/dbConnect";
import SellerOrder from "@/models/SellerOrder";

// An advance entry's status ("DELIVERY" etc.) reflects real physical
// progress that already happened (material was shipped) - if that's further
// along than the new official order's own status, the surviving merged
// record should reflect that, not silently regress back to an earlier stage.
const STATUS_PROGRESS = ["TO CHECK", "READY TO SHIP", "DELIVERY", "HISAB", "FULFILLED"];

// POST /api/seller-orders/merge - body: { advanceOrderId, newOrderId }.
// Consolidates the Advance entry and the newly-placed official order into a
// SINGLE surviving record (the new order, since it carries the real
// firmCode/contractNo/contractDate/rate) and deletes the Advance entry, so
// exactly one final record remains - not two linked ones.
export async function POST(req: Request) {
  try {
    await dbConnect();
    const { advanceOrderId, newOrderId } = await req.json();

    if (!advanceOrderId || !newOrderId) {
      return NextResponse.json({ error: "advanceOrderId and newOrderId are required" }, { status: 400 });
    }
    if (advanceOrderId === newOrderId) {
      return NextResponse.json({ error: "Cannot merge an order with itself" }, { status: 400 });
    }

    const [advanceOrder, newOrder] = await Promise.all([
      SellerOrder.findById(advanceOrderId),
      SellerOrder.findById(newOrderId),
    ]);

    if (!advanceOrder) return NextResponse.json({ error: "Advance order not found" }, { status: 404 });
    if (!newOrder) return NextResponse.json({ error: "New order not found" }, { status: 404 });
    if (!advanceOrder.isAdvance) return NextResponse.json({ error: "advanceOrderId is not an Advance entry" }, { status: 400 });
    if (advanceOrder.merged) return NextResponse.json({ error: "This Advance entry is already merged" }, { status: 409 });

    // Carry the advance shipment's details onto the surviving record.
    if (advanceOrder.deliveryDate && !newOrder.deliveryDate) {
      newOrder.deliveryDate = advanceOrder.deliveryDate;
    }
    if (advanceOrder.transportName && !newOrder.transportName) {
      newOrder.transportName = advanceOrder.transportName;
    }
    if (advanceOrder.remark) {
      newOrder.remark = newOrder.remark ? `${newOrder.remark} | Advance: ${advanceOrder.remark}` : `Advance: ${advanceOrder.remark}`;
    }

    const advanceIdx = STATUS_PROGRESS.indexOf(advanceOrder.status);
    const newIdx = STATUS_PROGRESS.indexOf(newOrder.status);
    if (advanceIdx > newIdx) {
      newOrder.status = advanceOrder.status;
    }

    newOrder.mergedFromOrderId = advanceOrder._id;
    await newOrder.save();

    // The advance entry is now redundant - its data lives on the surviving
    // record above. Removed rather than kept+flagged, so only one final
    // record remains per the spec (not two linked rows).
    await SellerOrder.deleteOne({ _id: advanceOrder._id });

    return NextResponse.json({ success: true, order: newOrder });
  } catch (error: any) {
    console.error("POST seller-orders/merge error:", error);
    return NextResponse.json({ error: error.message || "Failed to merge orders" }, { status: 500 });
  }
}
