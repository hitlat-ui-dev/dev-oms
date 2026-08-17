import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db();

    // 1. Fetch purchase requests
    const data = await db.collection("purchase_requests").aggregate([
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: "items",
          localField: "itemName",
          foreignField: "itemName",
          as: "masterInfo"
        }
      },
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: [
              "$$ROOT",
              { $arrayElemAt: ["$masterInfo", 0] },
              { 
                _id: "$$ROOT._id", 
                createdAt: "$$ROOT.createdAt", 
                itemName: "$$ROOT.itemName" 
              }
            ]
          }
        }
      },
      { $project: { masterInfo: 0, history: 0 } }
    ]).toArray();

    // 2. Fetch Order place Purchase totals grouped by SKU
    const opTotals = await db.collection("Order place Purchase").aggregate([
      {
        $group: {
          _id: { $toUpper: { $trim: { input: "$sku" } } },
          totalOrderQty: { $sum: { $convert: { input: "$orderQty", to: "double", onError: 0 } } }
        }
      }
    ]).toArray();
    const opMap: Record<string, number> = {};
    opTotals.forEach((t: any) => { if (t._id) opMap[t._id] = t.totalOrderQty; });

    // 3. Fetch stock to get reQty - only the two fields actually used below,
    // instead of shipping every stock field (this was a second full,
    // unprojected stock read on top of the page's own /api/stock call)
    const stockItems = await db.collection("stock").find({}, { projection: { sku: 1, reQty: 1 } }).toArray();
    const stockMap: Record<string, number> = {};
    stockItems.forEach((s: any) => {
      const skuKey = (s.sku || "").trim().toUpperCase();
      if (skuKey) stockMap[skuKey] = Number(s.reQty || 0);
    });

    // 4. Enrich purchase requests with extraQty and opQty
    const enrichedData = data.map((pr: any) => {
      const skuKey = (pr.sku || "").trim().toUpperCase();
      const orderedQty = opMap[skuKey] || 0;
      const reQty = stockMap[skuKey] || 0;
      const extra = Math.max(0, orderedQty - reQty);
      return {
        ...pr,
        extraQty: extra,
        opQty: orderedQty
      };
    });

    return NextResponse.json(enrichedData);
  } catch (error) {
    return NextResponse.json([]);
  }
}