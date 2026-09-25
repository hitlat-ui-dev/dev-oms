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
// that page needs zero changes. By default every row keeps its OWN
// firmCode (whatever the extension's firm picker was set to at scrape
// time, per order) - `firmCode` in the body is only an explicit override
// applied uniformly to every selected row, and must be opted into (an
// earlier version always required one and applied it to the whole batch,
// which silently overwrote a correctly-tagged firm with whatever firm the
// dropdown happened to be on - e.g. NAND orders landing as VINAY).
export async function POST(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");
    const body = await req.json();

    const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
    const overrideFirmCode = (body.firmCode || "").toString().trim().toUpperCase();

    if (ids.length === 0) {
      return NextResponse.json({ error: "No orders selected" }, { status: 400, headers: corsHeaders });
    }

    const objectIds = ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
    const rows = await db.collection("gem_order_intake").find({ _id: { $in: objectIds } }).toArray();

    let transferred = 0;
    const skipped: { contractNo: string; reason: string }[] = [];

    for (const row of rows) {
      const firmCode = overrideFirmCode || (row.firmCode || "").toString().trim().toUpperCase();
      if (!firmCode) {
        // Left in intake (not deleted) so it can be retried once a firm is
        // picked - unlike the duplicate cases below, this isn't resolved.
        skipped.push({ contractNo: row.contractNo, reason: "No firm tagged at fetch time - pick an override firm and retry" });
        continue;
      }

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
