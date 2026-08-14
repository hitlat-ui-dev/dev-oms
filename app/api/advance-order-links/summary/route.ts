import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "dev_oms_db";
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// GET: one row per Advance Order — advance qty, how much later GeM orders have covered
// (summed from advance_order_links, never stored redundantly), remaining/uncovered qty,
// and a status label. Powers the Advance Order Tracker page's main table.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const firmCode = searchParams.get("firmCode");

    const client = await clientPromise;
    const db = client.db(DB_NAME);

    const orderMatch: Record<string, any> = { isAdvanceOrder: true };
    if (firmCode) orderMatch.firmCode = firmCode;

    const advanceOrders = await db.collection("sellerorders").find(orderMatch).sort({ createdAt: -1 }).toArray();
    if (advanceOrders.length === 0) return NextResponse.json([]);

    const advanceOrderIds = advanceOrders.map((o) => String(o._id));
    const coveredAgg = await db
      .collection("advance_order_links")
      .aggregate([
        { $match: { advanceOrderId: { $in: advanceOrderIds } } },
        { $group: { _id: "$advanceOrderId", coveredQty: { $sum: "$linkedQty" }, linkCount: { $sum: 1 } } },
      ])
      .toArray();
    const coveredById = new Map(coveredAgg.map((c) => [c._id, c]));

    const summary = advanceOrders.map((o) => {
      const advanceQty = Number(o.reQty || 0);
      const covered = coveredById.get(String(o._id));
      const coveredQty = round2(covered?.coveredQty || 0);
      const remainingQty = round2(Math.max(0, advanceQty - coveredQty));
      const status = coveredQty <= 0 ? "Not Covered" : coveredQty >= advanceQty ? "Fully Covered" : "Partially Covered";
      return {
        orderId: String(o._id),
        orderNo: o.orderNo,
        firmCode: o.firmCode,
        instituteName: o.instituteName,
        itemName: o.itemName,
        contractDate: o.contractDate,
        advanceQty,
        coveredQty,
        remainingQty,
        linkCount: covered?.linkCount || 0,
        status,
      };
    });

    return NextResponse.json(summary);
  } catch (error: any) {
    console.error("advance-order-links summary GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to build summary" }, { status: 500 });
  }
}
