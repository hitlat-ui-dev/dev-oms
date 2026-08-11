import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

/**
 * Build a "fingerprint" key from ALL meaningful fields of a history entry.
 * Date is compared at YYYY-MM-DD level (same day = same, ignores race-condition ms diff).
 * Only debit entries (stock-deducting) are checked.
 */
function buildKey(entry: any): string | null {
  const type       = String(entry.type       || "").trim();
  const qty        = Number(entry.qty        || 0);
  const orderNo    = String(entry.orderNo    || "").trim();
  const sellerName = String(entry.sellerName || "").trim();
  const otherDetails = String(entry.otherDetails || "").trim();

  // Only check debit (stock-removing) entries
  const typeLower = type.toLowerCase();
  const isDebit =
    qty < 0 ||
    typeLower.includes("ready to ship") ||
    typeLower.includes("partial ship") ||
    typeLower.includes("delivery");

  if (!isDebit || !orderNo) return null; // skip non-debit or entries without an order ref

  // Date: use YYYY-MM-DD only — ignore time so race-condition duplicates (ms apart) are caught
  let dateStr = "";
  if (entry.date) {
    try {
      dateStr = new Date(entry.date).toISOString().split("T")[0];
    } catch {
      dateStr = String(entry.date).substring(0, 10);
    }
  }

  // Full fingerprint — ALL fields must match
  return `${type}||${qty}||${orderNo}||${sellerName}||${otherDetails}||${dateStr}`;
}

// ─────────────────────────────────────────────────────────────
// GET  → Scan ONLY negative-stock items for fully-identical duplicates
// ─────────────────────────────────────────────────────────────
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");

    // ✅ ONLY items with negative currentStock
    const items = await db.collection("items").find({ currentStock: { $lt: 0 } }).toArray();

    const results: any[] = [];

    for (const item of items) {
      const history: any[] = item.history || [];

      // Group entry indexes by their full fingerprint
      const seen = new Map<string, number[]>();

      history.forEach((entry: any, idx: number) => {
        const key = buildKey(entry);
        if (!key) return;
        if (!seen.has(key)) seen.set(key, []);
        seen.get(key)!.push(idx);
      });

      // Collect only groups with true duplicates (count > 1)
      const duplicates: any[] = [];
      seen.forEach((indexes, key) => {
        if (indexes.length <= 1) return;

        const firstEntry = history[indexes[0]];
        const extraCount = indexes.length - 1;
        const extraDeducted = extraCount * Math.abs(Number(firstEntry.qty || 0));

        duplicates.push({
          // Readable fields for UI
          type:          String(firstEntry.type       || "").trim(),
          orderNo:       String(firstEntry.orderNo    || "").trim(),
          sellerName:    String(firstEntry.sellerName || "").trim(),
          otherDetails:  String(firstEntry.otherDetails || "").trim(),
          qty:           Number(firstEntry.qty || 0),
          date:          firstEntry.date
                           ? new Date(firstEntry.date).toISOString().split("T")[0]
                           : "unknown",
          count:         indexes.length,
          extraCount,
          extraDeducted,
          indexes,       // which positions in history[] are duplicates
        });
      });

      if (duplicates.length === 0) continue;

      const totalExtraDeducted = duplicates.reduce((s, d) => s + d.extraDeducted, 0);

      results.push({
        sku:                item.sku,
        itemName:           item.itemName,
        currentStock:       item.currentStock,
        duplicates,
        totalExtraDeducted,
        correctedStock:     (item.currentStock || 0) + totalExtraDeducted,
      });
    }

    return NextResponse.json({
      totalAffectedItems: results.length,
      totalNegativeItems: items.length,
      items: results,
    });

  } catch (error: any) {
    console.error("[CHECK-DUPLICATES GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────
// POST → Remove confirmed duplicates & restore stock (negative items only)
// ─────────────────────────────────────────────────────────────
export async function POST() {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");

    // ✅ ONLY items with negative currentStock
    const items = await db.collection("items").find({ currentStock: { $lt: 0 } }).toArray();

    let totalItemsFixed      = 0;
    let totalEntriesRemoved  = 0;
    let totalStockRestored   = 0;
    const fixLog: any[]      = [];

    for (const item of items) {
      const history: any[] = item.history || [];

      // Build fingerprint map
      const seen = new Map<string, number[]>();
      history.forEach((entry: any, idx: number) => {
        const key = buildKey(entry);
        if (!key) return;
        if (!seen.has(key)) seen.set(key, []);
        seen.get(key)!.push(idx);
      });

      // Collect indexes to remove (keep FIRST occurrence, delete the rest)
      const indexesToRemove = new Set<number>();
      let stockToRestore = 0;

      seen.forEach((indexes) => {
        if (indexes.length <= 1) return;
        // indexes[0] = keep, indexes[1..n] = remove
        indexes.slice(1).forEach((idx) => {
          indexesToRemove.add(idx);
          stockToRestore += Math.abs(Number(history[idx].qty || 0));
        });
      });

      if (indexesToRemove.size === 0) continue;

      // Build cleaned history
      const cleanedHistory = history.filter((_, idx) => !indexesToRemove.has(idx));

      // New corrected stock — don't go above what it was + restored (don't artificially inflate)
      const newStock = (item.currentStock || 0) + stockToRestore;

      // 1. Update items collection
      await db.collection("items").updateOne(
        { _id: item._id },
        {
          $set: {
            history:      cleanedHistory,
            currentStock: newStock,   // allow negative if still genuinely negative
          }
        }
      );

      // 2. Update stock collection quantity by the same amount
      await db.collection("stock").updateOne(
        { sku: item.sku },
        [
          {
            $set: {
              quantity: { $add: [{ $ifNull: ["$quantity", 0] }, stockToRestore] }
            }
          }
        ]
      );

      totalItemsFixed++;
      totalEntriesRemoved += indexesToRemove.size;
      totalStockRestored  += stockToRestore;

      fixLog.push({
        sku:            item.sku,
        itemName:       item.itemName,
        entriesRemoved: indexesToRemove.size,
        stockRestored:  stockToRestore,
        oldStock:       item.currentStock,
        newStock:       newStock,
      });
    }

    return NextResponse.json({
      success: true,
      totalItemsFixed,
      totalEntriesRemoved,
      totalStockRestored,
      fixLog,
      message: `Fixed ${totalItemsFixed} item(s) — removed ${totalEntriesRemoved} duplicate entries — restored ${totalStockRestored} units of stock.`,
    });

  } catch (error: any) {
    console.error("[CHECK-DUPLICATES POST]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
