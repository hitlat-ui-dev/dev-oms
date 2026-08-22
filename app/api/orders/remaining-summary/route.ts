import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

// GET /api/orders/remaining-summary - per-institute count of orders still
// sitting in "TO CHECK" or "READY TO SHIP" (i.e. not yet delivered/fulfilled),
// plus how many days the oldest of those has been pending. Deliberately its
// own on-demand endpoint (not part of the main orders list fetch) since it
// scans every open order across every institute - only worth the query when
// someone actually opens the "Remaining Order" popup.
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");

    const rows = await db
      .collection("sellerorders")
      .aggregate([
        { $match: { status: { $in: ["TO CHECK", "READY TO SHIP"] } } },
        {
          $group: {
            _id: { $ifNull: ["$instituteName", "Unknown Institute"] },
            toCheckCount: { $sum: { $cond: [{ $eq: ["$status", "TO CHECK"] }, 1, 0] } },
            readyToShipCount: { $sum: { $cond: [{ $eq: ["$status", "READY TO SHIP"] }, 1, 0] } },
            oldestOrderDate: { $min: { $ifNull: ["$createdAt", "$orderDate"] } },
          },
        },
        { $sort: { oldestOrderDate: 1 } },
      ])
      .toArray();

    const now = Date.now();
    const summary = rows.map((r) => ({
      instituteName: r._id,
      toCheckCount: r.toCheckCount,
      readyToShipCount: r.readyToShipCount,
      oldestOrderDate: r.oldestOrderDate,
      daysPending: r.oldestOrderDate
        ? Math.floor((now - new Date(r.oldestOrderDate).getTime()) / (24 * 60 * 60 * 1000))
        : null,
    }));

    return NextResponse.json(summary);
  } catch (error: any) {
    console.error("Remaining order summary error:", error);
    return NextResponse.json({ error: error.message || "Failed to load summary" }, { status: 500 });
  }
}
