import { NextResponse, after } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { syncPurchaseRequest } from "@/lib/syncPurchaseRequest";

// A seller's registered instituteName is the single source of truth - same
// helper as app/api/seller-orders/route.ts.
async function resolveCanonicalInstituteName(db: any, sellerId: any, fallback: string): Promise<string> {
  if (!sellerId || !ObjectId.isValid(sellerId)) return fallback;
  try {
    const seller = await db.collection("sellers").findOne({ _id: new ObjectId(sellerId) });
    return seller?.instituteName || fallback;
  } catch {
    return fallback;
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

// POST: Save several different items entered under one contract (Seller
// Order Entry's "Add Another Item" rows) as one SellerOrder document per
// item - the schema stays "1 order = 1 item" (billing already groups by
// contractNo, not a 1:1 assumption, and the existing variant-split save
// already proves several docs sharing one contract works end to end) - all
// items here just share a generated orderGroupId tag and, unlike the
// sequential single-item POSTs variant-split already does, are written
// inside one MongoDB transaction: if any item fails (bad item id, duplicate
// contract+item, etc.) nothing from this batch is saved, not even the ones
// before it.
export async function POST(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");
    const body = await req.json();

    const items: any[] = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) {
      return NextResponse.json({ error: "At least one item is required" }, { status: 400, headers: corsHeaders });
    }
    for (const item of items) {
      if (!item.itemId || !ObjectId.isValid(item.itemId)) {
        return NextResponse.json({ error: `Invalid item selected: "${item.itemName || "unknown"}"` }, { status: 400, headers: corsHeaders });
      }
      if (!Number(item.qty) || Number(item.qty) <= 0) {
        return NextResponse.json({ error: `Quantity must be more than 0 for "${item.itemName}"` }, { status: 400, headers: corsHeaders });
      }
    }
    if (!body.firmCode) {
      return NextResponse.json({ error: "Firm Code is required" }, { status: 400, headers: corsHeaders });
    }

    const contractNo = (body.contractNo || "").trim();
    const instituteName = await resolveCanonicalInstituteName(db, body.sellerId, body.instituteName || "");
    const orderGroupId = new ObjectId().toString();

    const session = client.startSession();
    const savedOrders: any[] = [];
    const stockBumps: { itemSku: string; orderQty: number; itemId: any; itemName: string; category: string; unit: string; orderNo: string }[] = [];

    try {
      await session.withTransaction(async () => {
        savedOrders.length = 0;
        stockBumps.length = 0;

        // Duplicate check per item, scoped to (contractNo + itemId) - same
        // rule the single-order route uses, so two different items under one
        // contract are allowed but the same item twice under it isn't.
        if (contractNo) {
          for (const item of items) {
            const existing = await db.collection("sellerorders").findOne(
              { contractNo, itemId: new ObjectId(item.itemId) },
              { session }
            );
            if (existing) {
              throw new Error(`Duplicate contract number for item "${item.itemName}" (already order ${existing.orderNo})`);
            }
          }
        }

        for (const item of items) {
          const orderQty = Number(item.qty || 0);
          const rate = Number(item.rate || 0);
          const totalAmount = orderQty * rate;
          const itemSku = (item.sku || "").trim();

          // Generate the next OD#### order number inside the transaction so
          // each item in this batch gets its own unique, sequential one -
          // re-read (not just locally incremented) per item since this same
          // transaction's own prior insert must be visible to the next read.
          const lastOrder = await db.collection("sellerorders")
            .find({}, { projection: { orderNo: 1 }, session })
            .sort({ orderNo: -1 }).limit(1).toArray();
          let newOrderNo = "OD0001";
          if (lastOrder.length > 0 && lastOrder[0].orderNo) {
            const m = lastOrder[0].orderNo.match(/\d+/);
            const n = m ? parseInt(m[0]) : 0;
            newOrderNo = `OD${(n + 1).toString().padStart(4, "0")}`;
          }
          let exists = await db.collection("sellerorders").findOne({ orderNo: newOrderNo }, { session });
          while (exists) {
            const num = parseInt(newOrderNo.replace("OD", "")) + 1;
            newOrderNo = `OD${num.toString().padStart(4, "0")}`;
            exists = await db.collection("sellerorders").findOne({ orderNo: newOrderNo }, { session });
          }

          const orderDoc = {
            orderNo: newOrderNo,
            firmCode: body.firmCode || "",
            subParty: body.subParty || "",
            sellerId: body.sellerId && ObjectId.isValid(body.sellerId) ? new ObjectId(body.sellerId) : null,
            instituteName,
            itemId: new ObjectId(item.itemId),
            itemName: item.itemName,
            category: item.category || "",
            unit: item.unit || "",
            sku: itemSku,
            contractDate: body.contractDate || "",
            contractNo,
            contractUrl: body.contractUrl || "",
            reQty: orderQty,
            rate,
            totalAmount,
            remark: body.remark || "",
            status: "TO CHECK",
            isPaid: false,
            transportName: "",
            transportRemark: "",
            deliveryDate: body.deliveryDate || "",
            createdBy: body.createdBy || "",
            isAdvance: !!body.isAdvance,
            merged: false,
            mergedFromOrderId: null,
            orderGroupId,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          await db.collection("sellerorders").insertOne(orderDoc, { session });
          savedOrders.push(orderDoc);

          // Deduct stock from GeM Listings if a contract URL is provided -
          // same step the single-order route takes.
          if (orderQty > 0 && body.contractUrl && body.contractUrl.trim() !== "") {
            await db.collection("gem_listings").updateOne(
              { firmCode: body.firmCode, itemId: String(item.itemId) },
              { $inc: { availGemStock: -orderQty } },
              { session }
            );
            await db.collection("gem_listings").updateOne(
              { firmCode: body.firmCode, itemId: String(item.itemId), availGemStock: { $lt: 0 } },
              { $set: { availGemStock: 0 } },
              { session }
            );
          }

          if (itemSku && orderQty > 0) {
            const skuFilter = { sku: itemSku };
            await db.collection("stock").updateOne(skuFilter, { $inc: { reQty: orderQty } }, { session });
            await db.collection("items").updateOne(skuFilter, { $inc: { reQty: orderQty } }, { session });
            stockBumps.push({
              itemSku, orderQty,
              itemId: item.itemId, itemName: item.itemName, category: item.category, unit: item.unit,
              orderNo: newOrderNo
            });
          }
        }
      });
    } finally {
      await session.endSession();
    }

    // Auto Purchase Request sync per item, after the transaction has
    // committed - fire-and-forget, same reasoning as the single-order route
    // (several sequential cross-collection queries; doing this inline before
    // responding risked pushing latency past the function timeout).
    for (const bump of stockBumps) {
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
          console.error("[AUTO PR ERROR] Failed to sync purchase request (bulk):", prError);
        }
      });
    }

    return NextResponse.json({ success: true, orders: savedOrders, orderGroupId }, { status: 201, headers: corsHeaders });
  } catch (error: any) {
    console.error("Bulk seller-orders POST error:", error);
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}
