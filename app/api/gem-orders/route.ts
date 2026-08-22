import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

// GET: Fetch all raw GeM orders received from Chrome Extension
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");

    const rawOrders = await db.collection("raw_gem_orders")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    return NextResponse.json(rawOrders, { status: 200, headers: corsHeaders });
  } catch (error: any) {
    console.error("GET raw_gem_orders error:", error);
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}

// POST: Save new fetched GeM order from Chrome Extension
export async function POST(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");
    const data = await req.json();

    const contractNo = data.contractNo?.trim();

    if (!contractNo) {
      return NextResponse.json({ error: "Contract number is required" }, { status: 400, headers: corsHeaders });
    }

    // Check duplicate in raw_gem_orders collection
    const existingRaw = await db.collection("raw_gem_orders").findOne({ contractNo });
    if (existingRaw) {
      return NextResponse.json({ error: "Duplicate order already fetched", duplicate: true }, { status: 409, headers: corsHeaders });
    }

    // Check if already verified and moved to main sellerorders collection
    const existingSellerOrder = await db.collection("sellerorders").findOne({ contractNo });
    if (existingSellerOrder) {
      return NextResponse.json({ error: "Order already verified in Main Orders", duplicate: true }, { status: 409, headers: corsHeaders });
    }

    const orderQty = Number(data.qty || data.orderQty || 1);
    const rate = Number(data.rate || 0);
    const totalAmount = Number(data.total || data.totalAmount || (orderQty * rate));

    const rawOrderDoc = {
      contractNo,
      contractDate: data.contractDate || "",
      contractUrl: data.contractUrl || data.pdfLink || "",
      buyerDesignation: data.buyerDesignation || "",
      department: data.department || "",
      location: data.location || "",
      instituteName: data.instituteName || [data.buyerDesignation, data.department, data.location].filter(Boolean).join(" - ") || "GeM Buyer",
      itemName: data.itemName || data.itemNameRaw || "GeM Order Item",
      qty: orderQty,
      rate,
      totalAmount,
      firmCode: (data.firmCode || "").toString().trim().toUpperCase(),
      gemStatus: data.gemStatus || "",
      status: "UNVERIFIED",
      source: "GeM Chrome Extension",
      createdAt: new Date(),
      updatedAt: new Date()
    };

    try {
      await db.collection("raw_gem_orders").insertOne(rawOrderDoc);
      // Firm-level "when was this last fetched" log - kept separate from
      // raw_gem_orders because those rows get deleted once verified, which
      // would otherwise erase the fetch history for a firm the moment its
      // last pending order gets cleared.
      if (rawOrderDoc.firmCode) {
        await db.collection("gem_order_fetch_log").updateOne(
          { firmCode: rawOrderDoc.firmCode },
          { $set: { firmCode: rawOrderDoc.firmCode, lastFetchedAt: new Date() } },
          { upsert: true }
        );
      }
    } catch (insertErr: any) {
      // The findOne check above is a race, not a guarantee (two overlapping
      // extension runs could both pass it for the same contractNo) - the
      // unique index on contractNo is the real backstop, so a duplicate-key
      // error here just means someone else won the race a moment ago.
      if (insertErr?.code === 11000) {
        return NextResponse.json({ error: "Duplicate order already fetched", duplicate: true }, { status: 409, headers: corsHeaders });
      }
      throw insertErr;
    }

    return NextResponse.json(rawOrderDoc, { status: 201, headers: corsHeaders });
  } catch (error: any) {
    console.error("POST raw_gem_orders error:", error);
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}
