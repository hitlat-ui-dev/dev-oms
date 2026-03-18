import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db();

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
              // Fields from purchase_requests (takes priority for ID/Dates)
              "$$ROOT",
              // Merge first object from items if found
              { $arrayElemAt: ["$masterInfo", 0] },
              // Overwrite with original PR data to ensure status/qty remain correct
              { 
                _id: "$$ROOT._id", 
                createdAt: "$$ROOT.createdAt", 
                itemName: "$$ROOT.itemName" 
              }
            ]
          }
        }
      },
      { $project: { masterInfo: 0 } } 
    ]).toArray();

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json([]);
  }
}