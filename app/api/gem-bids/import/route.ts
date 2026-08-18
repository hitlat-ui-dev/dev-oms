import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { applyImport } from "@/lib/gemBids/applyImport";

const DB_NAME = "dev_oms_db";

// The GeM Bid Exporter extension's popup posts here directly (chrome-extension:// origin),
// same CORS convention already used by the other extension-facing routes (gem-orders, seller-orders).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

// POST: import a freshly-fetched batch of GeM bid rows — either parsed client-side from the
// extension's .xlsx export, or posted directly by the extension's "Send to OMS" button
// (body.source: "xlsx_import" | "extension_direct"). Either way this runs the same
// exclusion-filter + three-way diff/tag engine + expiry sweep against what's already
// stored — keyed on Bid No, never duplicated. See lib/gemBids/applyImport.ts for the
// full pipeline (shared with the sync/apply route) and diffEngine.ts for the compare rules.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { rows, fileName, userName, source } = body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "rows are required" }, { status: 400, headers: corsHeaders });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);

    const result = await applyImport(db, { rows, fileName, userName, source });

    return NextResponse.json(result, { headers: corsHeaders });
  } catch (error: any) {
    console.error("GeM bid import error:", error);
    return NextResponse.json({ error: error.message || "Import failed" }, { status: 500, headers: corsHeaders });
  }
}
