import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getPricelistDb } from "@/lib/pricelist/db";
import { parsePricelist, supplierCodeOf } from "@/lib/pricelist/parse";
import { diffAgainstActive } from "@/lib/pricelist/diff";
import { uploadFileToR2 } from "@/lib/cloudflareR2";

export const runtime = "nodejs";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// POST multipart { file, userName }: parse + validate + diff against the current ACTIVE
// version. Nothing is written to the live collections; a clean file is parked in
// pricelist_staging (TTL 2h) and the original is stored on R2, so /commit only needs the token.
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const userName = String(form.get("userName") || "");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      return NextResponse.json({ error: "Only .xlsx files are accepted" }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parsePricelist(buffer);

    const report: any = {
      fileName: file.name,
      headerErrors: parsed.headerErrors,
      errors: parsed.errors,
      warnings: parsed.warnings,
      totalRows: parsed.totalRows,
    };
    if (parsed.headerErrors.length || parsed.errors.length || parsed.rows.length === 0) {
      if (!parsed.headerErrors.length && !parsed.errors.length) report.errors = [{ row: 0, column: "", message: "No data rows found" }];
      report.canCommit = false;
      return NextResponse.json(report);
    }

    const { db } = await getPricelistDb();
    const rows = parsed.rows;

    const codes = Array.from(new Set(rows.map((r) => supplierCodeOf(r.sku_key))));
    if (codes.length > 1) {
      report.errors.push({ row: 0, column: "sku_key", message: `File mixes several supplier prefixes (${codes.join(", ")}); upload one supplier per file` });
    }
    const supplierCode = codes[0];

    // A sku_key already owned by a different supplier would silently hijack that item on commit.
    const clash = await db
      .collection("pricelist_items")
      .find({ sku_key: { $in: rows.map((r) => r.sku_key) }, supplier_code: { $ne: supplierCode } })
      .project({ sku_key: 1, supplier_code: 1 })
      .limit(20)
      .toArray();
    for (const c of clash as any[]) {
      report.errors.push({ row: 0, column: "sku_key", message: `${c.sku_key} already belongs to supplier ${c.supplier_code}` });
    }
    if (report.errors.length) {
      report.canCommit = false;
      return NextResponse.json(report);
    }

    const diff = await diffAgainstActive(db, supplierCode, rows);
    const priced = rows.filter((r) => r.price_status === "PRICED").length;
    const summary = {
      total: rows.length,
      priced,
      onRequest: rows.length - priced,
      brands: new Set(rows.map((r) => r.brand).filter(Boolean)).size,
      categories: new Set(rows.map((r) => r.category)).size,
    };

    const token = randomUUID();
    const fileKey = `pricelists/${supplierCode}/${token}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
    await uploadFileToR2(buffer, fileKey, XLSX_TYPE);
    await db.collection("pricelist_staging").insertOne({
      token,
      supplier_code: supplierCode,
      rows,
      file_name: file.name,
      file_key: fileKey,
      uploaded_by: userName,
      history_skus: Array.from(diff.historySkus),
      diff_summary: { added: diff.added.length, changed: diff.changed.length, removed: diff.removed.length, unchanged: diff.unchanged },
      created_at: new Date(),
    });

    return NextResponse.json({
      ...report,
      canCommit: true,
      token,
      supplierCode,
      supplierName: rows[0].supplier_name,
      brand: rows[0].brand,
      summary,
      preview: rows.slice(0, 50),
      diff: {
        added: diff.added.length,
        addedSample: diff.added.slice(0, 100).map((r) => ({ sku_key: r.sku_key, price: r.unit_price_incl_gst })),
        changed: diff.changed,
        removed: diff.removed,
        unchanged: diff.unchanged,
      },
    });
  } catch (error: any) {
    console.error("Pricelist validate error:", error);
    return NextResponse.json({ error: error.message || "Validation failed" }, { status: 500 });
  }
}
