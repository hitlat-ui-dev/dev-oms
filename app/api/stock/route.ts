import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db();

    // Aggregation to group by itemName and sum quantities
    const stockData = await db.collection("Received purchase").aggregate([
      {
        $group: {
          _id: { $toUpper: "$itemName" }, // Group by item name (case-insensitive)
          totalQty: { $sum: "$receivedQty" },
          minRate: { $min: "$rate" },
          maxRate: { $max: "$rate" },
          unit: { $first: "$unit" }
        }
      },
      {
        $project: {
          _id: 0,
          itemName: "$_id",
          totalQty: 1,
          unit: 1,
          // If min and max are same, show one. If different, show "min to max"
          rateDisplay: {
            $cond: [
              { $eq: ["$minRate", "$maxRate"] },
              { $concat: [{ $toString: "$minRate" }, " rs"] },
              { $concat: [{ $toString: "$minRate" }, " to ", { $toString: "$maxRate" }, " rs"] }
            ]
          }
        }
      },
      { $sort: { itemName: 1 } }
    ]).toArray();

    return NextResponse.json(stockData);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}