import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

// GET: Fetch disabled intake rows for the "Disabled" tab - these were
// bulk-disabled from the Intake tab (app/api/gem-order-intake/disable) and
// are otherwise invisible/permanently excluded; this is the only place they
// can still be reviewed and (via the existing transfer endpoint, which
// doesn't filter on `disabled`) brought back into Fetched GeM Orders.
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");

    const rows = await db.collection("gem_order_intake")
      .find({ disabled: true })
      .sort({ disabledAt: -1 })
      .toArray();

    return NextResponse.json(rows, { status: 200, headers: corsHeaders });
  } catch (error: any) {
    console.error("GET disabled gem_order_intake error:", error);
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}
