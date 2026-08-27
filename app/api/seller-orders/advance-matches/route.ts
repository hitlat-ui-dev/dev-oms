import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import dbConnect from "@/lib/dbConnect";

// GET /api/seller-orders/advance-matches - only ever called by the explicit
// "Check Advance Matches" button, never automatically. Runs one bulk search
// across every un-merged Advance entry, finds regular (non-Advance) orders
// sharing the same Institute Name AND Item, and groups the suggested pairs
// by institute for a single merge-review pass instead of a check per order.
export async function GET() {
  try {
    await dbConnect();
    const client = await clientPromise;
    const db = client.db("dev_oms_db");
    const col = db.collection("sellerorders");

    const advanceOrders = await col
      .find({ isAdvance: true, merged: { $ne: true } })
      .sort({ createdAt: -1 })
      .toArray();

    if (advanceOrders.length === 0) {
      return NextResponse.json([]);
    }

    const instituteNames = Array.from(new Set(advanceOrders.map((o) => o.instituteName)));
    const regularOrders = await col
      .find({ isAdvance: { $ne: true }, instituteName: { $in: instituteNames } })
      .toArray();

    // itemId can be stored as either a real ObjectId or a plain string
    // depending which creation path the order went through (see
    // app/api/seller-orders/route.ts) - comparing as strings here sidesteps
    // that instead of relying on a DB-level type-sensitive match.
    const regularByKey = new Map<string, any[]>();
    for (const r of regularOrders) {
      const key = `${r.instituteName}|||${String(r.itemId)}`;
      if (!regularByKey.has(key)) regularByKey.set(key, []);
      regularByKey.get(key)!.push(r);
    }

    const groupsByInstitute = new Map<string, any[]>();
    for (const a of advanceOrders) {
      const key = `${a.instituteName}|||${String(a.itemId)}`;
      const matches = regularByKey.get(key) || [];
      for (const regularOrder of matches) {
        if (!groupsByInstitute.has(a.instituteName)) groupsByInstitute.set(a.instituteName, []);
        groupsByInstitute.get(a.instituteName)!.push({ advanceOrder: a, regularOrder });
      }
    }

    const groups = Array.from(groupsByInstitute.entries()).map(([instituteName, pairs]) => ({
      instituteName,
      pairs,
    }));

    return NextResponse.json(groups);
  } catch (error: any) {
    console.error("GET seller-orders/advance-matches error:", error);
    return NextResponse.json({ error: error.message || "Failed to check advance matches" }, { status: 500 });
  }
}
