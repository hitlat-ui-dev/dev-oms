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

// GET: Fetch all pending (non-disabled) GeM order intake rows for the triage page
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");

    const rows = await db.collection("gem_order_intake")
      .find({ disabled: { $ne: true } })
      .sort({ createdAt: -1 })
      .toArray();

    return NextResponse.json(rows, { status: 200, headers: corsHeaders });
  } catch (error: any) {
    console.error("GET gem_order_intake error:", error);
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}

// POST: Save a newly scraped GeM order from the Chrome Extension into the
// intake/triage collection - NOT the same as raw_gem_orders. A human picks
// which of these are real orders on the intake page and "Transfer"s only
// those into raw_gem_orders (which feeds the existing Fetched GeM Orders
// review page, untouched by this pipeline). Anything left behind can be
// "Disable"d so a re-scrape never re-imports it.
export async function POST(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");
    const data = await req.json();

    const contractNo = data.contractNo?.trim();

    if (!contractNo) {
      return NextResponse.json({ error: "Contract number is required" }, { status: 400, headers: corsHeaders });
    }

    // Duplicate checks, in the order a contractNo could already exist:
    // 1. still sitting in the intake list itself (pending or disabled)
    // 2. already transferred into raw_gem_orders (pending verification)
    // 3. already verified into Main Orders (sellerorders)
    const existingIntake = await db.collection("gem_order_intake").findOne({ contractNo });
    if (existingIntake) {
      return NextResponse.json({ error: "Duplicate order already fetched", duplicate: true }, { status: 409, headers: corsHeaders });
    }

    const existingRaw = await db.collection("raw_gem_orders").findOne({ contractNo });
    if (existingRaw) {
      return NextResponse.json({ error: "Duplicate order already fetched", duplicate: true }, { status: 409, headers: corsHeaders });
    }

    const existingSellerOrder = await db.collection("sellerorders").findOne({ contractNo });
    if (existingSellerOrder) {
      return NextResponse.json({ error: "Order already verified in Main Orders", duplicate: true }, { status: 409, headers: corsHeaders });
    }

    const orderQty = Number(data.qty || data.orderQty || 1);
    const rate = Number(data.rate || 0);
    const totalAmount = Number(data.total || data.totalAmount || (orderQty * rate));

    const intakeDoc = {
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
      source: "GeM Chrome Extension",
      disabled: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    try {
      await db.collection("gem_order_intake").insertOne(intakeDoc);
      // Same "last fetched per firm" log the old direct-to-raw_gem_orders
      // route wrote to, so History on the existing Fetched GeM Orders page
      // keeps working the same regardless of which staging list a firm's
      // scrape actually lands in.
      if (intakeDoc.firmCode) {
        await db.collection("gem_order_fetch_log").updateOne(
          { firmCode: intakeDoc.firmCode },
          { $set: { firmCode: intakeDoc.firmCode, lastFetchedAt: new Date() } },
          { upsert: true }
        );
      }
    } catch (insertErr: any) {
      // findOne-then-insert above is a race, not a guarantee - the unique
      // index on contractNo (see ensure-indexes) is the real backstop.
      if (insertErr?.code === 11000) {
        return NextResponse.json({ error: "Duplicate order already fetched", duplicate: true }, { status: 409, headers: corsHeaders });
      }
      throw insertErr;
    }

    return NextResponse.json(intakeDoc, { status: 201, headers: corsHeaders });
  } catch (error: any) {
    console.error("POST gem_order_intake error:", error);
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}
