import { NextResponse, after } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { syncPurchaseRequest } from "@/lib/syncPurchaseRequest";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

// DELETE: Reject/Delete a raw fetched GeM order
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");
    const { id } = await params;

    const result = await db.collection("raw_gem_orders").deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "Order not found" }, { status: 404, headers: corsHeaders });
    }

    return NextResponse.json({ success: true, message: "Raw GeM order deleted" }, { status: 200, headers: corsHeaders });
  } catch (error: any) {
    console.error("DELETE raw order error:", error);
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}

// POST: Verify and move raw GeM order to main sellerorders collection
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");
    const { id } = await params;

    const body = await req.json();

    // 1. Find raw order
    const rawOrder = await db.collection("raw_gem_orders").findOne({ _id: new ObjectId(id) });
    if (!rawOrder) {
      return NextResponse.json({ error: "Raw GeM order not found" }, { status: 404, headers: corsHeaders });
    }

    // 2. Generate new OD Order Number
    const lastOrder = await db.collection("sellerorders").find({}, { projection: { orderNo: 1 } }).sort({ orderNo: -1 }).limit(1).toArray();
    let newOrderNo = "OD0001";
    if (lastOrder && lastOrder.length > 0 && lastOrder[0].orderNo) {
      const lastNoMatch = lastOrder[0].orderNo.match(/\d+/);
      const lastNoNumeric = lastNoMatch ? parseInt(lastNoMatch[0]) : 0;
      newOrderNo = `OD${(lastNoNumeric + 1).toString().padStart(4, "0")}`;
    }

    // Double check uniqueness
    let exists = await db.collection("sellerorders").findOne({ orderNo: newOrderNo });
    while (exists) {
      const num = parseInt(newOrderNo.replace("OD", "")) + 1;
      newOrderNo = `OD${num.toString().padStart(4, "0")}`;
      exists = await db.collection("sellerorders").findOne({ orderNo: newOrderNo });
    }

    const orderQty = Number(body.qty || rawOrder.qty || 1);
    const rate = Number(body.rate || rawOrder.rate || 0);
    const totalAmount = Number(body.totalAmount || rawOrder.totalAmount || (orderQty * rate));

    // A linked seller's registered instituteName is the source of truth — prefer it over
    // whatever raw text was typed/scraped, so this order's name can't drift from the
    // institute it's actually linked to (see the same guard in app/api/seller-orders/route.ts).
    const rawInstituteName = body.instituteName || rawOrder.instituteName || "GeM Buyer";
    let canonicalInstituteName = rawInstituteName;
    if (body.sellerId && ObjectId.isValid(body.sellerId)) {
      const sellerDoc = await db.collection("sellers").findOne({ _id: new ObjectId(body.sellerId) });
      canonicalInstituteName = sellerDoc?.instituteName || rawInstituteName;
    }

    // 3. Construct verified main order document
    const verifiedOrder = {
      orderNo: newOrderNo,
      firmCode: body.firmCode || "GeM",
      sellerId: body.sellerId ? new ObjectId(body.sellerId) : null,
      instituteName: canonicalInstituteName,
      itemId: body.itemId ? new ObjectId(body.itemId) : null,
      itemName: body.itemName || rawOrder.itemName || "GeM Order Item",
      category: body.category || "General",
      unit: body.unit || "nos",
      sku: body.sku || "",
      contractDate: body.contractDate || rawOrder.contractDate || "",
      contractNo: rawOrder.contractNo,
      contractUrl: rawOrder.contractUrl || "",
      reQty: orderQty,
      rate,
      totalAmount,
      remark: body.remark || "",
      status: "TO CHECK",
      isPaid: false,
      transportName: "",
      transportRemark: "",
      deliveryDate: "",
      createdBy: body.createdBy || "",
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // 4. Save to main sellerorders collection
    await db.collection("sellerorders").insertOne(verifiedOrder);

    // 5. Remove from raw_gem_orders collection
    await db.collection("raw_gem_orders").deleteOne({ _id: new ObjectId(id) });

    // 6. Bump reQty on the linked item's stock, then resync its Auto Purchase
    // Request - same two steps app/api/seller-orders/route.ts does for a
    // manually-added order, just missing here before. Fire-and-forget after
    // the response so a slow deficit scan can't push this past a function
    // timeout the way it would if awaited inline.
    const itemSku = (body.sku || "").trim();
    if (itemSku && orderQty > 0) {
      const skuFilter = { sku: itemSku };
      await db.collection("stock").updateOne(skuFilter, { $inc: { reQty: orderQty } }, { upsert: false });
      await db.collection("items").updateOne(skuFilter, { $inc: { reQty: orderQty } }, { upsert: false });

      after(async () => {
        try {
          await syncPurchaseRequest(db, itemSku, {
            itemId: body.itemId,
            itemName: verifiedOrder.itemName,
            category: verifiedOrder.category,
            unit: verifiedOrder.unit,
            orderNo: newOrderNo
          });
        } catch (prError) {
          console.error("[AUTO PR ERROR] Failed to sync purchase request for verified GeM order:", prError);
        }
      });
    }

    return NextResponse.json({ success: true, message: "Order verified and moved to Main Orders", orderNo: newOrderNo }, { status: 200, headers: corsHeaders });
  } catch (error: any) {
    console.error("Verify order error:", error);
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}
