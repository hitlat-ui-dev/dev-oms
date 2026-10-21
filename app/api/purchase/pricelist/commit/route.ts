import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getPricelistDb } from "@/lib/pricelist/db";
import { applyDiscount } from "@/lib/pricelist/applyDiscount";
import { diffAgainstActive } from "@/lib/pricelist/diff";

export const runtime = "nodejs";

// POST { token, userName }: persist a previously validated upload.
// One transaction: new pricelist version, items upsert by sku_key, items missing from the file
// flagged is_active:false (never deleted), previous ACTIVE version of that supplier archived.
export async function POST(req: Request) {
  const { client, db } = await getPricelistDb();
  try {
    const { token, userName, discount_pct, overwrite_discount } = await req.json();
    if (!token) return NextResponse.json({ error: "token is required" }, { status: 400 });

    const staged: any = await db.collection("pricelist_staging").findOne({ token });
    if (!staged) {
      return NextResponse.json({ error: "Upload expired or already saved - please upload the file again" }, { status: 404 });
    }
    let rows: any[] = staged.rows;
    const supplierCode: string = staged.supplier_code;
    let historySkus = new Set<string>(staged.history_skus || []);
    let diffSummary = staged.diff_summary;

    const disc = discount_pct === "" || discount_pct === null || discount_pct === undefined ? null : Number(discount_pct);
    if (disc !== null) {
      if (!(disc >= 0 && disc <= 100)) return NextResponse.json({ error: "Discount must be between 0 and 100" }, { status: 400 });
      rows = applyDiscount(rows, disc, !!overwrite_discount);
      // Prices changed, so the diff / price-history set must be recomputed.
      const diff = await diffAgainstActive(db, supplierCode, rows);
      historySkus = diff.historySkus;
      diffSummary = { added: diff.added.length, changed: diff.changed.length, removed: diff.removed.length, unchanged: diff.unchanged };
    }
    const first = rows[0];
    const now = new Date();
    const pricelistId = new ObjectId();

    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        await db.collection("pricelists").updateMany(
          { supplier_code: supplierCode, status: "ACTIVE" },
          { $set: { status: "ARCHIVED" } },
          { session }
        );
        await db.collection("pricelists").insertOne(
          {
            _id: pricelistId,
            supplier_name: first.supplier_name,
            brand: first.brand,
            supplier_code: supplierCode,
            valid_from: new Date(first.valid_from),
            file_name: staged.file_name,
            file_url: staged.file_key,
            row_count: rows.length,
            on_request_count: rows.filter((r) => r.price_status === "ON_REQUEST").length,
            status: "ACTIVE",
            uploaded_by: staged.uploaded_by || userName || "",
            uploaded_at: now,
            diff_summary: diffSummary,
          },
          { session }
        );

        const ops: any[] = rows.map((r) => {
          const update: any = {
            $set: { ...r, pricelist_id: pricelistId, supplier_code: supplierCode, source: "upload", is_active: true, updated_at: now },
            $setOnInsert: { created_at: now },
          };
          if (historySkus.has(r.sku_key)) {
            update.$push = {
              price_history: { pricelist_id: pricelistId, valid_from: r.valid_from, unit_price_incl_gst: r.unit_price_incl_gst },
            };
          }
          return { updateOne: { filter: { sku_key: r.sku_key }, update, upsert: true } };
        });
        // Chunked so a 10k-row file doesn't build one giant command.
        for (let i = 0; i < ops.length; i += 1000) {
          await db.collection("pricelist_items").bulkWrite(ops.slice(i, i + 1000), { session, ordered: false });
        }
        await db.collection("pricelist_items").updateMany(
          { supplier_code: supplierCode, is_active: true, source: { $ne: "manual" }, sku_key: { $nin: rows.map((r) => r.sku_key) } },
          { $set: { is_active: false, updated_at: now } },
          { session }
        );
      });
    } finally {
      await session.endSession();
    }

    await db.collection("pricelist_staging").deleteOne({ token });
    return NextResponse.json({ ok: true, pricelistId: String(pricelistId), diff_summary: diffSummary, rowCount: rows.length });
  } catch (error: any) {
    console.error("Pricelist commit error:", error);
    return NextResponse.json({ error: error.message || "Commit failed" }, { status: 500 });
  }
}
