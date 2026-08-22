import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

// GET /api/bills/eligible-orders?firmCode=XXX
// Lists un-billed SellerOrder line items for a firm, grouped by contractNo
// (a GeM contract can carry multiple line items, and a bill covers exactly
// one contract's worth of un-billed lines).
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const firmCode = (searchParams.get("firmCode") || "").trim().toUpperCase();
    // ?exempted=true switches this from "still needs a bill" to "was marked
    // exempt" - same grouping/shape, used by the review/undo panel.
    const exempted = searchParams.get("exempted") === "true";
    if (!firmCode) {
      return NextResponse.json({ error: "firmCode is required" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db();

    const orders = await db
      .collection("sellerorders")
      // Mongo's { field: null } matches both an explicit null AND a missing
      // field, which covers pre-existing orders that predate the billId field.
      .find(
        exempted
          ? { firmCode, billExempt: true }
          // An order already cancelled (e.g. via Bill History's "Cancel
          // Order") shouldn't come back as something to bill - it has
          // nothing left to invoice.
          : { firmCode, billId: null, billExempt: { $ne: true }, status: { $ne: "CANCELL ORDER" } }
      )
      .sort({ contractNo: 1, createdAt: 1 })
      .toArray();

    const sellerIds = [...new Set(orders.map((o) => o.sellerId).filter(Boolean).map((id: any) => String(id)))];
    const sellers = sellerIds.length
      ? await db.collection("sellers").find({ _id: { $in: sellerIds.map((id) => new ObjectId(id)) } }).toArray()
      : [];
    const sellerById = new Map(sellers.map((s) => [String(s._id), s]));

    const itemIds = [...new Set(orders.map((o) => o.itemId).filter(Boolean).map((id: any) => String(id)))];
    const items = itemIds.length
      ? await db.collection("items").find({ _id: { $in: itemIds.map((id) => new ObjectId(id)) } }).toArray()
      : [];
    const itemById = new Map(items.map((it) => [String(it._id), it]));

    const groups = new Map<string, any>();
    for (const o of orders) {
      const key = o.contractNo || `_no_contract_${o._id}`;
      if (!groups.has(key)) {
        const seller = o.sellerId ? sellerById.get(String(o.sellerId)) : null;
        groups.set(key, {
          contractNo: o.contractNo || "",
          contractDate: o.contractDate || "",
          sellerId: o.sellerId,
          instituteName: seller?.instituteName || o.instituteName,
          buyerState: seller?.state || "",
          orders: [],
        });
      }
      const itemDoc = o.itemId ? itemById.get(String(o.itemId)) : null;
      groups.get(key).orders.push({
        _id: o._id,
        itemId: o.itemId,
        itemName: o.itemName,
        sku: o.sku,
        unit: o.unit,
        reQty: o.reQty,
        rate: o.rate,
        totalAmount: o.totalAmount,
        hsnSac: itemDoc?.hsnSac || "",
        gstPercent: itemDoc?.gstPercent || 0,
        ...(exempted
          ? {
              billExemptReason: o.billExemptReason || "",
              billExemptNote: o.billExemptNote || "",
              billExemptAt: o.billExemptAt || null,
              billExemptBy: o.billExemptBy || "",
            }
          : {}),
      });
    }

    return NextResponse.json(Array.from(groups.values()));
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch eligible orders" }, { status: 500 });
  }
}
