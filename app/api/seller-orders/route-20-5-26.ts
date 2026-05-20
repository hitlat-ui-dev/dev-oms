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

    // --- 3. CREATE ORDER ---
    const newOrder = await SellerOrder.create({
      ...data,
      orderNo: newOrderNo,
      reQty: orderQty,
      totalAmount,
      sku: data.sku || "",
      status: data.status || "TO CHECK",
    });

    // --- 4. UPDATE STOCK DB (The Bulletproof Fix) ---
    // We create a flexible query to find the stock item
    let stockQuery: any = null;

    if (data.itemId) {
      // Try finding by ID (Handles both string and ObjectId formats)
      stockQuery = {
        $or: [
          { _id: data.itemId },
          { _id: new mongoose.Types.ObjectId(data.itemId) }
        ]
      };
    } else if (data.itemName) {
      // Fallback to exact name match
      stockQuery = { itemName: data.itemName.trim() };
    }

    if (stockQuery) {
      const result = await db.collection("stock").updateOne(
        stockQuery,
        { $inc: { reQty: orderQty } },
        { upsert: false } // Change to false to prevent creating "empty" items if match fails
      );
      
      console.log("Stock Sync Result:", result.matchedCount > 0 ? "SUCCESS" : "ITEM NOT FOUND");
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
    // Field name in your DB: "prQty"
    const prTotals = await db.collection("purchase_requests").aggregate([
      {
        $group: {
          _id: { $toUpper: { $trim: { input: "$itemName" } } },
          total: { $sum: { $convert: { input: "$prQty", to: "double", onError: 0 } } }
        }
      }
    ]).toArray();

    // 3. Aggregate OP Quantities from 'Order place Purchase'
    // Collection name: "Order place Purchase" | Field name: "orderQty"
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