import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

// POST: Bulk-move selected intake rows into raw_gem_orders - the exact
// collection the existing Fetched GeM Orders page already reads from, so
// that page needs zero changes. Every transferred row is tagged with
// whatever firm was picked on the intake page (overriding anything the
// extension guessed at scrape time).
export async function POST(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");
    const body = await req.json();

    const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
    const firmCode = (body.firmCode || "").toString().trim().toUpperCase();

    if (ids.length === 0) {
      return NextResponse.json({ error: "No orders selected" }, { status: 400, headers: corsHeaders });
    }
    if (!firmCode) {
      return NextResponse.json({ error: "Firm is required" }, { status: 400, headers: corsHeaders });
    }

    const objectIds = ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
    const rows = await db.collection("gem_order_intake").find({ _id: { $in: objectIds } }).toArray();

    let transferred = 0;
    const skipped: { contractNo: string; reason: string }[] = [];

    for (const row of rows) {
      // Same duplicate guard as the direct extension path - a row can only
      // reach here once, but re-running a transfer (e.g. a double click)
      // must not create a second copy in raw_gem_orders.
      const existingRaw = await db.collection("raw_gem_orders").findOne({ contractNo: row.contractNo });
      const existingSellerOrder = existingRaw ? null : await db.collection("sellerorders").findOne({ contractNo: row.contractNo });
      if (existingRaw || existingSellerOrder) {
        skipped.push({ contractNo: row.contractNo, reason: existingRaw ? "Already in Fetched GeM Orders" : "Already verified in Main Orders" });
        await db.collection("gem_order_intake").deleteOne({ _id: row._id });
        continue;
      }

      const rawOrderDoc = {
        contractNo: row.contractNo,
        contractDate: row.contractDate || "",
        contractUrl: row.contractUrl || "",
        buyerDesignation: row.buyerDesignation || "",
        department: row.department || "",
        location: row.location || "",
        instituteName: row.instituteName || "GeM Buyer",
        itemName: row.itemName || "GeM Order Item",
        qty: row.qty,
        rate: row.rate,
        totalAmount: row.totalAmount,
        firmCode,
        gemStatus: row.gemStatus || "",
        status: "UNVERIFIED",
        source: "GeM Chrome Extension",
        createdAt: new Date(),
        updatedAt: new Date()
      };

      try {
        await db.collection("raw_gem_orders").insertOne(rawOrderDoc);
        await db.collection("gem_order_intake").deleteOne({ _id: row._id });
        transferred++;
      } catch (insertErr: any) {
        if (insertErr?.code === 11000) {
          skipped.push({ contractNo: row.contractNo, reason: "Already in Fetched GeM Orders" });
          await db.collection("gem_order_intake").deleteOne({ _id: row._id });
          continue;
        }
        throw insertErr;
      }
    }

    return NextResponse.json({ success: true, transferred, skipped }, { status: 200, headers: corsHeaders });
  } catch (error: any) {
    console.error("Bulk transfer intake error:", error);
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}
