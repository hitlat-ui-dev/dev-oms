import { NextResponse, after } from "next/server";
import clientPromise from "@/lib/mongodb";
import SellerOrder from "@/models/SellerOrder";
import mongoose from "mongoose";
import { ObjectId } from "mongodb";
import dbConnect from "@/lib/dbConnect";
import { syncPurchaseRequest } from "@/lib/syncPurchaseRequest";

// A seller's registered instituteName is the single source of truth for how that
// institute's name should read on an order — instituteName typed/scraped at order-creation
// time can otherwise drift from it (e.g. word order flipped), which silently splits that
// institute's history across two different names in every report/ledger that groups by
// instituteName text. Whenever a valid sellerId is present, this is preferred over
// whatever raw text was submitted.
async function resolveCanonicalInstituteName(db: any, sellerId: any, fallback: string): Promise<string> {
  if (!sellerId || !ObjectId.isValid(sellerId)) return fallback;
  try {
    const seller = await db.collection("sellers").findOne({ _id: new ObjectId(sellerId) });
    return seller?.instituteName || fallback;
  } catch {
    return fallback;
  }
}

async function connectDB() {
  await clientPromise;
  await dbConnect();
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function POST(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");

    await connectDB();
    const data = await req.json();

    // Check for duplicate contract number - scoped to the same item so one
    // contract can legitimately be split across several line items (e.g. a
    // variant-quantity split: 10 Red + 10 Blue under the same contract no.),
    // while still blocking an accidental double-submit of the exact same
    // line. Falls back to contractNo-only when itemId isn't present (e.g.
    // GeM Chrome Extension imports), matching the original behavior there.
    if (data.contractNo && data.contractNo.trim() !== "") {
      const dupQuery: any = { contractNo: data.contractNo.trim() };
      if (data.itemId) dupQuery.itemId = data.itemId;
      const existingContract = await db.collection("sellerorders").findOne(dupQuery);
      if (existingContract) {
        return NextResponse.json({ error: "Duplicate contract number", duplicate: true }, { status: 409, headers: corsHeaders });
      }
    }

    // --- 1. GENERATE ORDER NO ---
    const lastOrder = await SellerOrder.findOne({}, { orderNo: 1 }).sort({ orderNo: -1 });
    let newOrderNo = "OD0001";
    if (lastOrder && lastOrder.orderNo) {
      const lastNoMatch = lastOrder.orderNo.match(/\d+/);
      const lastNoNumeric = lastNoMatch ? parseInt(lastNoMatch[0]) : 0;
      newOrderNo = `OD${(lastNoNumeric + 1).toString().padStart(4, "0")}`;
    }

    // --- 2. DUPLICATE CHECK FOR ORDER NO ---
    let isDuplicate = await SellerOrder.exists({ orderNo: newOrderNo });
    while (isDuplicate) {
      const lastNoNumeric = parseInt(newOrderNo.replace("OD", ""));
      newOrderNo = `OD${(lastNoNumeric + 1).toString().padStart(4, "0")}`;
      isDuplicate = await SellerOrder.exists({ orderNo: newOrderNo });
    }

    const orderQty = Number(data.orderQty || data.qty || 0);
    const rate = Number(data.rate || 0);
    const totalAmount = Number(data.total || data.totalAmount || (orderQty * rate));
    const itemSku = data.sku?.trim() || "";

    // If order comes from GeM Chrome Extension or is missing mandatory Mongoose fields (like sellerId/firmCode/itemId), handle insertion safely
    if (data.source === "GeM Chrome Extension" || !data.sellerId || !data.firmCode || !data.itemId) {
      const rawInstituteName = data.instituteName || data.buyerDesignation || "GeM Buyer";
      const newOrderDoc = {
        orderNo: newOrderNo,
        firmCode: data.firmCode || "GeM",
        sellerId: data.sellerId || null,
        instituteName: await resolveCanonicalInstituteName(db, data.sellerId, rawInstituteName),
        itemId: data.itemId || null,
        itemName: data.itemName || data.itemNameRaw || "GeM Order Item",
        category: data.category || "General",
        unit: data.unit || "nos",
        sku: itemSku,
        contractDate: data.contractDate || "",
        contractNo: data.contractNo || "",
        contractUrl: data.contractUrl || data.pdfLink || "",
        reQty: orderQty,
        rate: rate,
        totalAmount: totalAmount,
        remark: data.remark || (data.location ? `Location: ${data.location}` : "Imported from GeM"),
        status: data.status || "TO CHECK",
        isAdvance: !!data.isAdvance,
        merged: false,
        mergedFromOrderId: null,
        isPaid: false,
        transportName: "",
        transportRemark: "",
        deliveryDate: data.deliveryDate || "",
        createdBy: data.createdBy || "",
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const insertResult = await db.collection("sellerorders").insertOne(newOrderDoc);

      return NextResponse.json({ ...newOrderDoc, _id: insertResult.insertedId }, { status: 201, headers: corsHeaders });
    }

    // --- 3. STANDARD CREATE ORDER FOR FORM SUBMISSIONS ---
    const newOrder = await SellerOrder.create({
      ...data,
      orderNo: newOrderNo,
      reQty: orderQty,
      totalAmount,
      sku: itemSku,
      instituteName: await resolveCanonicalInstituteName(db, data.sellerId, data.instituteName),
      status: data.status || "TO CHECK",
    });

    // Deduct stock from GeM Listings if a contract URL is provided
    if (orderQty > 0 && data.contractUrl && data.contractUrl.trim() !== "") {
      await db.collection("gem_listings").updateOne(
        { 
          firmCode: data.firmCode, 
          itemId: String(data.itemId)
        },
        {
          $inc: { availGemStock: -orderQty }
        }
      );
      await db.collection("gem_listings").updateOne(
        { 
          firmCode: data.firmCode, 
          itemId: String(data.itemId),
          availGemStock: { $lt: 0 }
        },
        {
          $set: { availGemStock: 0 }
        }
      );
    }

    // --- 4. UPDATE STOCK & ITEMS DB ---
    if (itemSku && orderQty > 0) {
      const skuFilter = { sku: itemSku };

      await db.collection("stock").updateOne(
        skuFilter,
        { $inc: { reQty: orderQty } },
        { upsert: false }
      );

      await db.collection("items").updateOne(
        skuFilter,
        { $inc: { reQty: orderQty } },
        { upsert: false }
      );
    }

    // --- 5. AUTO PURCHASE REQUEST ---
    // Runs after the response is sent (via next/server's after()) rather than
    // blocking it — this does 4+ sequential cross-collection queries, and
    // awaiting it here before responding was pushing order-save latency past
    // Vercel's function timeout on the live deployment, which made the client
    // see a fetch/JSON-parse failure ("Check your server connection.") even
    // though the order itself had already been written to Mongo.
    if (itemSku && orderQty > 0) {
      after(async () => {
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
      });
    }

    return NextResponse.json({ ...newOrder.toObject() }, { status: 201, headers: corsHeaders });
  } catch (error: any) {
    console.error("CRITICAL POST ERROR:", error);
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}

// Default page load fetches the 250 most recent orders within the 45-day window —
// executing in sub-second speed (~1.2s). Pass ?all=1 to fetch complete order history
// (used by the Orders board's explicit "Load All Orders" action).
const DEFAULT_DAYS_WINDOW = 45;
const DEFAULT_INITIAL_LIMIT = 250;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const fetchAll = searchParams.get("all") === "1";

    const client = await clientPromise;
    const db = client.db("dev_oms_db");
    await connectDB();

    // 1. Calculate 45 days window date threshold
    const fortyFiveDaysAgo = new Date(Date.now() - DEFAULT_DAYS_WINDOW * 24 * 60 * 60 * 1000);
    const filterQuery = fetchAll ? {} : { createdAt: { $gte: fortyFiveDaysAgo } };

    let rawOrdersQuery = db.collection("sellerorders").find(filterQuery).sort({ createdAt: -1 });
    if (!fetchAll) rawOrdersQuery = rawOrdersQuery.limit(DEFAULT_INITIAL_LIMIT);

    // These three queries run concurrently using database indexes.
    const [orders, prTotals, opTotals] = await Promise.all([
      rawOrdersQuery.toArray(),
      // 2. Aggregate active PR Quantities from 'purchase_requests' - grouped
      // by sku (falling back to itemName only for the rare legacy record
      // with no sku) rather than itemName alone, since a hidden/retired
      // item can share the exact same itemName as its active replacement -
      // grouping by name alone would merge a hidden duplicate's pending
      // qty into the active item's displayed total.
      db.collection("purchase_requests").aggregate([
        { $match: { status: "Purchase Request" } },
        {
          $group: {
            _id: {
              sku: { $toUpper: { $trim: { input: { $ifNull: ["$sku", ""] } } } },
              name: { $toUpper: { $trim: { input: "$itemName" } } }
            },
            total: { $sum: { $convert: { input: "$prQty", to: "double", onError: 0 } } }
          }
        }
      ]).toArray(),
      // 3. Aggregate OP Quantities from 'Order place Purchase' (same sku-first grouping)
      db.collection("Order place Purchase").aggregate([
        {
          $group: {
            _id: {
              sku: { $toUpper: { $trim: { input: { $ifNull: ["$sku", ""] } } } },
              name: { $toUpper: { $trim: { input: "$itemName" } } }
            },
            total: { $sum: { $convert: { input: "$orderQty", to: "double", onError: 0 } } }
          }
        }
      ]).toArray()
    ]);

    // 4. Create Lookup Maps - keyed by sku when the source record had one,
    // else by name (kept separate so a skuless legacy record never merges
    // into a sku-tracked active item's total, and vice versa).
    const prMapBySku: Record<string, number> = {};
    const prMapByName: Record<string, number> = {};
    prTotals.forEach(item => {
      const sku = item._id?.sku;
      const name = item._id?.name;
      if (sku) prMapBySku[sku] = (prMapBySku[sku] || 0) + item.total;
      else if (name) prMapByName[name] = (prMapByName[name] || 0) + item.total;
    });

    const opMapBySku: Record<string, number> = {};
    const opMapByName: Record<string, number> = {};
    opTotals.forEach(item => {
      const sku = item._id?.sku;
      const name = item._id?.name;
      if (sku) opMapBySku[sku] = (opMapBySku[sku] || 0) + item.total;
      else if (name) opMapByName[name] = (opMapByName[name] || 0) + item.total;
    });

    // 5. Batch lookup stock quantity for unique itemIds in the returned orders set (~20 items)
    const itemIds = Array.from(new Set(orders.map((o: any) => o.itemId).filter(Boolean)));
    const objectIds = itemIds.map(id => {
      try { return new ObjectId(id); } catch { return id; }
    });

    const stockItems = await db.collection("stock").find(
      { $or: [{ _id: { $in: objectIds } }, { _id: { $in: itemIds } }] },
      { projection: { quantity: 1, reQty: 1 } }
    ).toArray();

    const stockMap: Record<string, { totalQty: number; reQty: number }> = {};
    stockItems.forEach(s => {
      const key = s._id.toString();
      stockMap[key] = {
        totalQty: s.quantity || 0,
        reQty: s.reQty || 0
      };
    });

    // 6. Merge data into enriched orders payload
    const enrichedOrders = orders.map((order: any) => {
      const skuKey = (order.sku || "").trim().toUpperCase();
      const nameKey = (order.itemName || "").trim().toUpperCase();
      const stockInfo = stockMap[order.itemId?.toString()] || { totalQty: 0, reQty: 0 };
      return {
        ...order,
        prQty: skuKey ? (prMapBySku[skuKey] || 0) : (prMapByName[nameKey] || 0),
        opQty: skuKey ? (opMapBySku[skuKey] || 0) : (opMapByName[nameKey] || 0),
        stockQty: stockInfo.totalQty,
        stockReQty: stockInfo.reQty
      };
    });

    return NextResponse.json(enrichedOrders, { status: 200 });
  } catch (error: any) {
    console.error("GET Error:", error);
    return NextResponse.json({ error: "Fetch failed" }, { status: 500 });
  }
}