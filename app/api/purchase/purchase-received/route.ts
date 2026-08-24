import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db();

      const data = await db.collection("Received purchase").aggregate([
    
      // Joined on this record's own sku (already set correctly at receive
      // time - see app/api/received-purchase/route.ts's POST) rather than
      // itemName - a hidden/retired item often shares the exact same
      // itemName as its active replacement, and an itemName join has no way
      // to prefer one over the other, so it could silently overwrite this
      // record's own correct sku with the wrong (possibly hidden) item's.
      {
        $lookup: {
          from: "items",
          localField: "sku",
          foreignField: "sku",
          as: "masterDetails"
        }
      },
      {
        $addFields: {
          category: { $arrayElemAt: ["$masterDetails.category", 0] },
          location: { $arrayElemAt: ["$masterDetails.location", 0] }
        }
      },
      { $project: { masterDetails: 0 } }
    ]).toArray();

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json([]);
  }
}