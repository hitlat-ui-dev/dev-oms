import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db();

      const data = await db.collection("Received purchase").aggregate([
    
      {
        $lookup: {
          from: "items",
          localField: "itemName",
          foreignField: "itemName",
          as: "masterDetails"
        }
      },
      {
        $addFields: {
          category: { $arrayElemAt: ["$masterDetails.category", 0] },
          location: { $arrayElemAt: ["$masterDetails.location", 0] },
          sku: { $arrayElemAt: ["$masterDetails.sku", 0] }
        }
      },
      { $project: { masterDetails: 0 } }
    ]).toArray();

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json([]);
  }
}