import { NextResponse } from "next/server";
import { getPricelistDb } from "@/lib/pricelist/db";

export const runtime = "nodejs";

// Material Rates: a flat Rate/Unit/Remark list per material name (Copper,
// Cast Iron, Polypropylene, ... - same names Metal Calculator already uses,
// plus any custom one not in its density list), separate from the
// SKU-based supplier pricelist (pricelist_items). Metal Calculator
// (components/MetalCalculatorPanel.tsx) reads this same collection to show
// a material's rate and total cost - one list feeds both places.

// GET - every material rate on file, sorted by name.
export async function GET() {
  try {
    const { db } = await getPricelistDb();
    const rows = await db.collection("material_rates").find({}).sort({ name: 1 }).toArray();
    return NextResponse.json(rows.map((r: any) => ({ ...r, _id: String(r._id) })));
  } catch (error: any) {
    console.error("Material rates GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to load material rates" }, { status: 500 });
  }
}

// POST { name, rate, unit, remark, userName } - upsert by name (trimmed,
// exact-case - matches a Metal Calculator material name exactly so the
// lookup there is a plain key match).
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const name = String(body.name || "").trim();
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
    const rate = body.rate === "" || body.rate === null || body.rate === undefined ? null : Number(body.rate);
    if (rate !== null && (isNaN(rate) || rate < 0)) {
      return NextResponse.json({ error: "rate must be a non-negative number" }, { status: 400 });
    }

    const { db } = await getPricelistDb();
    const now = new Date();
    await db.collection("material_rates").updateOne(
      { name },
      {
        $set: {
          rate,
          unit: String(body.unit || "").trim(),
          remark: String(body.remark || "").trim(),
          updatedAt: now,
          updatedBy: body.userName || "",
        },
        $setOnInsert: { name, createdAt: now },
      },
      { upsert: true }
    );
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Material rates POST error:", error);
    return NextResponse.json({ error: error.message || "Failed to save material rate" }, { status: 500 });
  }
}

// DELETE ?name= - removes a custom (non-Metal-Calculator) material row entirely.
export async function DELETE(req: Request) {
  try {
    const name = (new URL(req.url).searchParams.get("name") || "").trim();
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
    const { db } = await getPricelistDb();
    await db.collection("material_rates").deleteOne({ name });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Material rates DELETE error:", error);
    return NextResponse.json({ error: error.message || "Failed to delete material rate" }, { status: 500 });
  }
}
