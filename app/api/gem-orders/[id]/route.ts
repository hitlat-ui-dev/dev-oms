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

// POST: Verify and move raw GeM order to main sellerorders collection - one
// contract (one raw_gem_orders row) can legitimately carry more than one
// item (a merge/multi-item PO), so `body.items` is an array and this
// creates one SellerOrder per entry, all sharing the same contract
// info/firm/institute, before consuming the single raw row once at the end.
// `body` without `items` (a single flat item body) is still accepted for
// backward compatibility, treated as a one-item array.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");
    const { id } = await params;

    const body = await req.json();
    const items: any[] = Array.isArray(body.items) && body.items.length > 0 ? body.items : [body];

    // 1. Find raw order
    const rawOrder = await db.collection("raw_gem_orders").findOne({ _id: new ObjectId(id) });
    if (!rawOrder) {
      return NextResponse.json({ error: "Raw GeM order not found" }, { status: 404, headers: corsHeaders });
    }

    // A linked seller's registered instituteName is the source of truth — prefer it over
    // whatever raw text was typed/scraped, so this order's name can't drift from the
    // institute it's actually linked to (see the same guard in app/api/seller-orders/route.ts).
    const rawInstituteName = body.instituteName || rawOrder.instituteName || "GeM Buyer";
    let canonicalInstituteName = rawInstituteName;
    if (body.sellerId && ObjectId.isValid(body.sellerId)) {
      const sellerDoc = await db.collection("sellers").findOne({ _id: new ObjectId(body.sellerId) });
      canonicalInstituteName = sellerDoc?.instituteName || rawInstituteName;
    }

    const newOrderNos: string[] = [];
    const stockBumps: { itemSku: string; orderQty: number; itemId: any; itemName: string; category: string; unit: string; orderNo: string }[] = [];

    for (const item of items) {
      // 2. Generate new OD Order Number - re-checked per item (not just
      // incremented locally) since each insertOne below makes the previous
      // orderNo actually exist before the next one is picked.
      const lastOrder = await db.collection("sellerorders").find({}, { projection: { orderNo: 1 } }).sort({ orderNo: -1 }).limit(1).toArray();
      let newOrderNo = "OD0001";
      if (lastOrder && lastOrder.length > 0 && lastOrder[0].orderNo) {
        const lastNoMatch = lastOrder[0].orderNo.match(/\d+/);
        const lastNoNumeric = lastNoMatch ? parseInt(lastNoMatch[0]) : 0;
        newOrderNo = `OD${(lastNoNumeric + 1).toString().padStart(4, "0")}`;
      }

      let exists = await db.collection("sellerorders").findOne({ orderNo: newOrderNo });
      while (exists) {
        const num = parseInt(newOrderNo.replace("OD", "")) + 1;
        newOrderNo = `OD${num.toString().padStart(4, "0")}`;
        exists = await db.collection("sellerorders").findOne({ orderNo: newOrderNo });
      }

      const orderQty = Number(item.qty || rawOrder.qty || 1);
      const rate = Number(item.rate || rawOrder.rate || 0);
      const totalAmount = Number(item.totalAmount || (orderQty * rate));

      // 3. Construct verified main order document
      const verifiedOrder = {
        orderNo: newOrderNo,
        firmCode: body.firmCode || "GeM",
        sellerId: body.sellerId ? new ObjectId(body.sellerId) : null,
        instituteName: canonicalInstituteName,
        itemId: item.itemId ? new ObjectId(item.itemId) : null,
        itemName: item.itemName || rawOrder.itemName || "GeM Order Item",
        category: item.category || "General",
        unit: item.unit || "nos",
        sku: item.sku || "",
        contractDate: body.contractDate || rawOrder.contractDate || "",
        contractNo: rawOrder.contractNo,
        contractUrl: rawOrder.contractUrl || "",
        reQty: orderQty,
        rate,
        totalAmount,
        remark: item.remark || "",
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
      newOrderNos.push(newOrderNo);

      const itemSku = (item.sku || "").trim();
      if (itemSku && orderQty > 0) {
        stockBumps.push({
          itemSku,
          orderQty,
          itemId: item.itemId,
          itemName: verifiedOrder.itemName,
          category: verifiedOrder.category,
          unit: verifiedOrder.unit,
          orderNo: newOrderNo
        });
      }
    }

    // 5. Remove the single raw_gem_orders row once, after every item's
    // SellerOrder has been created.
    await db.collection("raw_gem_orders").deleteOne({ _id: new ObjectId(id) });

    // 6. Bump reQty on each item's stock, then resync its Auto Purchase
    // Request - same two steps app/api/seller-orders/route.ts does for a
    // manually-added order. Fire-and-forget after the response so a slow
    // deficit scan can't push this past a function timeout the way it
    // would if awaited inline.
    for (const bump of stockBumps) {
      const skuFilter = { sku: bump.itemSku };
      await db.collection("stock").updateOne(skuFilter, { $inc: { reQty: bump.orderQty } }, { upsert: false });
      await db.collection("items").updateOne(skuFilter, { $inc: { reQty: bump.orderQty } }, { upsert: false });

      after(async () => {
        try {
          await syncPurchaseRequest(db, bump.itemSku, {
            itemId: bump.itemId,
            itemName: bump.itemName,
            category: bump.category,
            unit: bump.unit,
            orderNo: bump.orderNo
          });
        } catch (prError) {
          console.error("[AUTO PR ERROR] Failed to sync purchase request for verified GeM order:", prError);
        }
      });
    }

    return NextResponse.json({
      success: true,
      message: newOrderNos.length > 1 ? `${newOrderNos.length} orders verified and moved to Main Orders` : "Order verified and moved to Main Orders",
      orderNo: newOrderNos[0],
      orderNos: newOrderNos
    }, { status: 200, headers: corsHeaders });
  } catch (error: any) {
    console.error("Verify order error:", error);
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}
