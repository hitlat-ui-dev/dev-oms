import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

// Lists every distinct item variant group currently in use, so Add/Edit
// Item can offer them as a dropdown instead of free-typing a tag (a typo
// there would silently split one product family into two groups). A group
// isn't a record of its own - it just exists as soon as any item carries
// that variantGroup value, so there's nothing to create ahead of time.
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db();
    const groups = await db
      .collection("stock")
      .aggregate([
        { $match: { variantGroup: { $exists: true, $ne: "" } } },
        {
          $group: {
            _id: "$variantGroup",
            sampleName: { $first: "$itemName" },
            count: { $sum: 1 },
          },
        },
        { $sort: { sampleName: 1 } },
      ])
      .toArray();
    return NextResponse.json(
      groups.map((g: any) => ({ group: g._id, sampleName: g.sampleName, count: g.count }))
    );
  } catch {
    return NextResponse.json([]);
  }
}
