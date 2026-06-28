import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import SellerOrder from "@/models/SellerOrder";
import mongoose from "mongoose";

async function connectDB() {
  await clientPromise;
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI as string);
  }
}

async function syncPurchaseRequest(
  db: any,
  sku: string,
  itemDetails?: { itemId?: string; itemName?: string; category?: string; unit?: string; orderNo?: string }
) {
  if (!sku) return;
  const stockDoc = await db.collection("stock").findOne({ sku: sku });
  if (!stockDoc) return;

  const availableStock = Number(stockDoc.quantity || 0);
  const totalReQty = Number(stockDoc.reQty || 0);

  // Calculate active purchase orders (ordered stock on the way)
  const opOrders = await db.collection("Order place Purchase").find({ sku: sku }).toArray();
  const orderedStock = opOrders.reduce((sum: number, o: any) => sum + Number(o.orderQty || 0), 0);

  const deficit = totalReQty - (availableStock + orderedStock);

  const existingPR = await db.collection("purchase_requests").findOne({
    sku: sku,
    status: "Purchase Request"
  });

  if (deficit > 0) {
    if (existingPR) {
      await db.collection("purchase_requests").updateOne(
        { _id: existingPR._id },
        {
          $set: {
            prQty: deficit,
            updatedAt: new Date()
          }
        }
      );
      console.log(`[SYNC PR UPDATE] SKU: ${sku} | Updated PR | Qty: ${existingPR.prQty} → ${deficit}`);
    } else {
      await db.collection("purchase_requests").insertOne({
        itemId: itemDetails?.itemId || String(stockDoc._id || ""),
        itemName: itemDetails?.itemName || stockDoc.itemName || "",
        sku: sku,
        category: itemDetails?.category || stockDoc.category || "GENERAL",
        unit: itemDetails?.unit || stockDoc.unit || "NOS",
        prQty: deficit,
        remark: itemDetails?.orderNo ? `Auto-generated from Order ${itemDetails.orderNo}` : "Auto-generated deficit check",
        status: "Purchase Request",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log(`[SYNC PR CREATE] SKU: ${sku} | Created PR | Qty: ${deficit}`);
    }
  } else {
    if (existingPR) {
      await db.collection("purchase_requests").deleteOne({ _id: existingPR._id });
      console.log(`[SYNC PR DELETE] SKU: ${sku} | Deficit resolved, deleted PR`);
    }
  }
}

export async function POST(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");

    await connectDB();
    const data = await req.json();

    // --- 1. GENERATE ORDER NO (Your working logic) ---
    const lastOrder = await SellerOrder.findOne({}, { orderNo: 1 }).sort({ orderNo: -1 });
    let newOrderNo = "OD0001";
    if (lastOrder && lastOrder.orderNo) {
      const lastNoMatch = lastOrder.orderNo.match(/\d+/);
      const lastNoNumeric = lastNoMatch ? parseInt(lastNoMatch[0]) : 0;
      newOrderNo = `OD${(lastNoNumeric + 1).toString().padStart(4, "0")}`;
    }

    // --- 2. DUPLICATE CHECK ---
    let isDuplicate = await SellerOrder.exists({ orderNo: newOrderNo });
    while (isDuplicate) {
      const lastNoNumeric = parseInt(newOrderNo.replace("OD", ""));
      newOrderNo = `OD${(lastNoNumeric + 1).toString().padStart(4, "0")}`;
      isDuplicate = await SellerOrder.exists({ orderNo: newOrderNo });
    }

    const orderQty = Number(data.orderQty || 0);
    const totalAmount = orderQty * Number(data.rate || 0);
    const itemSku = data.sku?.trim();

    // --- 3. CREATE ORDER ---
    const newOrder = await SellerOrder.create({
      ...data,
      orderNo: newOrderNo,
      reQty: orderQty,
      totalAmount,
      sku: itemSku || "",
      status: data.status || "TO CHECK",
    });

    // --- 4. UPDATE STOCK & ITEMS DB (The Synced SKU Fix) ---
    if (itemSku && orderQty > 0) {
      const skuFilter = { sku: itemSku };

      // 1. Update reQty in stock collection
      const stockResult = await db.collection("stock").updateOne(
        skuFilter,
        { $inc: { reQty: orderQty } },
        { upsert: false }
      );

      // 2. 🟢 SYNCED: Update reQty in items collection simultaneously
      const itemsResult = await db.collection("items").updateOne(
        skuFilter,
        { $inc: { reQty: orderQty } },
        { upsert: false }
      );
      
      console.log(
        `[NEW ORDER STOCK SYNC] SKU: ${itemSku} | Stock Updated: ${stockResult.matchedCount > 0} | Items Updated: ${itemsResult.matchedCount > 0}`
      );
    } else {
      console.log("[NEW ORDER STOCK SYNC] Skipped: Missing SKU or orderQty is 0");
    }

    // --- 5. AUTO PURCHASE REQUEST (Stock Deficit Check) ---
    // After updating reQty, check if total pending orders exceed available stock.
    // If so, auto-create or update an existing Purchase Request for the deficit.
    if (itemSku && orderQty > 0) {
      try {
        await syncPurchaseRequest(db, itemSku, {
          itemId: data.itemId,
          itemName: data.itemName,
          category: data.category,
          unit: data.unit,
          orderNo: newOrderNo
        });
      } catch (prError) {
        console.error("[AUTO PR ERROR] Failed to sync purchase request:", prError);
      }
    }

    return NextResponse.json(newOrder, { status: 201 });
  } catch (error: any) {
    console.error("CRITICAL POST ERROR:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");
    await connectDB();

    // 1. Fetch Seller Orders
    const orders = await SellerOrder.find({}).sort({ createdAt: -1 }).lean();

    // 2. Aggregate PR Quantities from 'purchase_requests'
    const prTotals = await db.collection("purchase_requests").aggregate([
      {
        $group: {
          _id: { $toUpper: { $trim: { input: "$itemName" } } },
          total: { $sum: { $convert: { input: "$prQty", to: "double", onError: 0 } } }
        }
      }
    ]).toArray();

    // 3. Aggregate OP Quantities from 'Order place Purchase'
    const opTotals = await db.collection("Order place Purchase").aggregate([
      {
        $group: {
          _id: { $toUpper: { $trim: { input: "$itemName" } } },
          total: { $sum: { $convert: { input: "$orderQty", to: "double", onError: 0 } } }
        }
      }
    ]).toArray();

    // 4. Create Lookup Maps
    const prMap: Record<string, number> = {};
    prTotals.forEach(item => { if (item._id) prMap[item._id] = item.total; });

    const opMap: Record<string, number> = {};
    opTotals.forEach(item => { if (item._id) opMap[item._id] = item.total; });

    // 5. Merge data
    const enrichedOrders = orders.map((order: any) => {
      const nameKey = (order.itemName || "").trim().toUpperCase();
      return {
        ...order,
        prQty: prMap[nameKey] || 0,
        opQty: opMap[nameKey] || 0,
      };
    });

    return NextResponse.json(enrichedOrders, { status: 200 });
  } catch (error: any) {
    console.error("GET Error:", error);
    return NextResponse.json({ error: "Fetch failed" }, { status: 500 });
  }
}