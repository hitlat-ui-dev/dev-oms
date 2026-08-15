import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { uploadFileToR2, getFileFromR2, deleteFileFromR2 } from "@/lib/cloudflareR2";

const sheetR2Key = (id: string) => `gem-sync/sheets/${id}.json`;

// Helper: Deduplicate listings array by (itemId/itemName + firmCode + buyerId)
function deduplicateListings(items: any[]) {
  if (!Array.isArray(items)) return [];
  const seen = new Map<string, any>();

  for (const lst of items) {
    if (!lst) continue;
    const itemKey = (lst.itemId || lst.itemName || "").toString().trim().toLowerCase();
    const firmKey = (lst.firmCode || "").toString().trim().toLowerCase();
    const buyerKey = (lst.buyerId || "").toString().trim().toLowerCase();
    const key = `${itemKey}::${firmKey}::${buyerKey}`;

    if (!seen.has(key)) {
      seen.set(key, lst);
    } else {
      const existing = seen.get(key);
      // Keep the record with a GeM link or the more recent sync date
      const hasMoreInfo = !existing.gemLink && lst.gemLink;
      const isNewer = new Date(lst.date || 0).getTime() > new Date(existing.date || 0).getTime();
      if (hasMoreInfo || isNewer) {
        seen.set(key, lst);
      }
    }
  }

  return Array.from(seen.values());
}

// GET: Fetch the shared console state from MongoDB (with auto-deduplicated listings).
// ?sheetContent={id} instead fetches just that one sheet's heavy uploadedRows/
// originalExcelData payload from R2 on demand — never eagerly loaded for every
// sheet up front, so gem_sheets documents stay flat-sized no matter how large
// individual Excel uploads get.
export async function GET(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db();

    const { searchParams } = new URL(req.url);
    const sheetContentId = searchParams.get("sheetContent");
    if (sheetContentId) {
      const sheet = await db.collection("gem_sheets").findOne({ id: sheetContentId });
      if (!sheet || !sheet.r2Key) {
        return NextResponse.json({ error: "Sheet content not found" }, { status: 404 });
      }
      try {
        const bytes = await getFileFromR2(sheet.r2Key);
        const content = JSON.parse(bytes.toString("utf-8"));
        return NextResponse.json({
          uploadedRows: content.uploadedRows || [],
          originalExcelData: content.originalExcelData || [],
        });
      } catch (err) {
        console.error("Failed to fetch sheet content from R2:", err);
        return NextResponse.json({ error: "Could not load sheet content — check R2 connection" }, { status: 502 });
      }
    }

    // gem_rate_history is fetched separately (?rateHistory=1) rather than as
    // part of the main bulk load below — it's only used by the Upload Sheet
    // tab's "last quoted rate" hint, but a full unfiltered scan of it has been
    // observed taking 40+ seconds on this cluster (looks like Atlas shared-tier
    // throttling, not a query/index problem — small collection, tiny data size).
    // Keeping it out of the main response means every other tab (which never
    // needed it) stops waiting on that one slow collection.
    if (searchParams.get("rateHistory")) {
      const rateHistory = await db.collection("gem_rate_history").find({}).toArray();
      return NextResponse.json({ rateHistory: rateHistory.map(({ _id, ...rest }) => ({ ...rest })) });
    }

    // Fetch the remaining collections concurrently rather than one-at-a-time —
    // total wait becomes the slowest single query instead of the sum of all of them.
    const [buyers, rawListings, customItems, sheets, catalogueLinks, rowMappings] = await Promise.all([
      db.collection("gem_buyers").find({}).toArray(),
      db.collection("gem_listings").find({}).toArray(),
      db.collection("gem_custom_items").find({}).toArray(),
      db.collection("gem_sheets").find({}).toArray(),
      db.collection("gem_catalogue_links").find({}).toArray(),
      // Lightweight (originalName + mappedItemId only) per-sheet mapping history —
      // powers "Quick Fill from Master List" across all past sheets without
      // needing every sheet's full uploadedRows (which now live in R2).
      db.collection("gem_row_mappings").find({}).toArray(),
    ]);

    // Clean MongoDB _id fields for React/JSON serialization
    const cleanBuyers = buyers.map(({ _id, ...rest }) => ({ ...rest }));
    const cleanListings = rawListings.map(({ _id, ...rest }) => ({ ...rest }));
    const cleanCustomItems = customItems.map(({ _id, ...rest }) => ({ ...rest }));
    const cleanSheets = sheets.map(({ _id, ...rest }) => ({ ...rest }));
    const cleanCatalogueLinks = catalogueLinks.map(({ _id, ...rest }) => ({ ...rest }));
    const cleanRowMappings = rowMappings.map(({ _id, ...rest }) => ({ ...rest }));

    // Deduplicate listings
    const deduplicatedListings = deduplicateListings(cleanListings);

    // If duplicates were pruned, update MongoDB in background
    if (deduplicatedListings.length < cleanListings.length) {
      await db.collection("gem_listings").deleteMany({});
      if (deduplicatedListings.length > 0) {
        await db.collection("gem_listings").insertMany(deduplicatedListings);
      }
    }

    return NextResponse.json({
      buyers: cleanBuyers,
      listings: deduplicatedListings,
      customItems: cleanCustomItems,
      sheets: cleanSheets,
      catalogueLinks: cleanCatalogueLinks,
      rowMappings: cleanRowMappings
    });
  } catch (error) {
    console.error("GET gem-sync error:", error);
    return NextResponse.json({ error: "Failed to fetch state" }, { status: 500 });
  }
}

// POST: Save collections/sheets to MongoDB to share across team members
export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");
    const client = await clientPromise;
    const db = client.db();
    const body = await req.json();

    // Map helpers to discard MongoDB native _id if they are present in incoming payload
    const sanitizeBody = (items: any[]) => {
      if (!Array.isArray(items)) return [];
      return items.map(({ _id, ...rest }) => ({ ...rest }));
    };

    if (action === "save_buyers") {
      await db.collection("gem_buyers").deleteMany({});
      const sanitized = sanitizeBody(body);
      if (sanitized.length > 0) {
        await db.collection("gem_buyers").insertMany(sanitized);
      }
      return NextResponse.json({ success: true });
    }

    if (action === "save_listings") {
      await db.collection("gem_listings").deleteMany({});
      const sanitized = deduplicateListings(sanitizeBody(body));
      if (sanitized.length > 0) {
        await db.collection("gem_listings").insertMany(sanitized);
      }
      return NextResponse.json({ success: true, count: sanitized.length });
    }

    if (action === "cleanup_duplicates") {
      const rawListings = await db.collection("gem_listings").find({}).toArray();
      const cleanListings = rawListings.map(({ _id, ...rest }) => ({ ...rest }));
      const deduplicated = deduplicateListings(cleanListings);
      const removedCount = cleanListings.length - deduplicated.length;

      await db.collection("gem_listings").deleteMany({});
      if (deduplicated.length > 0) {
        await db.collection("gem_listings").insertMany(deduplicated);
      }

      return NextResponse.json({
        success: true,
        removedCount,
        remainingCount: deduplicated.length,
        listings: deduplicated
      });
    }

    if (action === "save_history") {
      await db.collection("gem_rate_history").deleteMany({});
      const sanitized = sanitizeBody(body);
      if (sanitized.length > 0) {
        await db.collection("gem_rate_history").insertMany(sanitized);
      }
      return NextResponse.json({ success: true });
    }

    if (action === "save_custom_items") {
      await db.collection("gem_custom_items").deleteMany({});
      const sanitized = sanitizeBody(body);
      if (sanitized.length > 0) {
        await db.collection("gem_custom_items").insertMany(sanitized);
      }
      return NextResponse.json({ success: true });
    }

    if (action === "save_sheet") {
      if (!body.id) {
        return NextResponse.json({ error: "Sheet ID is required" }, { status: 400 });
      }

      // Two distinct callers hit this action: the active-sheet auto-save (which
      // always has the full uploadedRows/originalExcelData in memory) and
      // metadata-only updates like toggling "completed" or changing the
      // associated buyer (which only ever have the lightweight Sheet Library
      // row, not the sheet's content). Only touch R2/counts/mappings when real
      // content was actually sent — otherwise a buyer-change or completed-toggle
      // on ANY sheet would silently overwrite its real data with an empty array.
      const hasContent = Array.isArray(body.uploadedRows);

      const metadataSet: any = {
        id: body.id,
        fileName: body.fileName || "",
        selectedBuyerId: body.selectedBuyerId || "",
        isCompleted: body.isCompleted !== undefined ? !!body.isCompleted : false,
        lastEditedBy: body.lastEditedBy || "",
        updatedAt: new Date().toISOString()
      };

      let sanitizedRows: any[] = [];
      if (hasContent) {
        sanitizedRows = sanitizeBody(body.uploadedRows);
        const originalExcelData = body.originalExcelData || [];

        // The heavy payload lives in R2, keyed by sheet id — Mongo only ever
        // stores lightweight metadata + derived counts + this pointer, so the
        // document's size never grows with the size of the uploaded Excel file.
        const r2Key = sheetR2Key(body.id);
        try {
          await uploadFileToR2(
            Buffer.from(JSON.stringify({ uploadedRows: sanitizedRows, originalExcelData })),
            r2Key,
            "application/json"
          );
        } catch (err) {
          console.error("Failed to upload sheet content to R2:", err);
          return NextResponse.json({ error: "Save failed — check R2 connection" }, { status: 502 });
        }
        metadataSet.totalRows = sanitizedRows.length;
        metadataSet.completedRows = sanitizedRows.filter((r: any) => r.isCompleted).length;
        metadataSet.r2Key = r2Key;
      }

      await db.collection("gem_sheets").updateOne(
        { id: body.id },
        {
          $set: metadataSet,
          // Only stamped the very first time this sheet id is created (the actual
          // upload event) — never overwritten by later edits/saves, unlike lastEditedBy.
          $setOnInsert: {
            uploadedBy: body.uploadedBy || "",
            uploadedAt: new Date().toISOString()
          },
          // Clean up any pre-migration doc that still had the heavy fields embedded.
          ...(hasContent ? { $unset: { uploadedRows: "", originalExcelData: "" } } : {})
        },
        { upsert: true }
      );

      if (hasContent) {
        // Keep this sheet's stripped mapping-history in sync too — only the two
        // fields "Quick Fill from Master List" actually needs, not the full row.
        const mappings = sanitizedRows
          .filter((r: any) => r.originalName && r.mappedItemId)
          .map((r: any) => ({ originalName: r.originalName, mappedItemId: r.mappedItemId }));
        await db.collection("gem_row_mappings").updateOne(
          { sheetId: body.id },
          { $set: { sheetId: body.id, mappings } },
          { upsert: true }
        );
      }

      return NextResponse.json({ success: true });
    }

    if (action === "delete_sheet") {
      if (!body.id) {
        return NextResponse.json({ error: "Sheet ID is required" }, { status: 400 });
      }
      try {
        await deleteFileFromR2(sheetR2Key(body.id));
      } catch (err) {
        console.error("Failed to delete sheet content from R2 (continuing):", err);
      }
      await db.collection("gem_sheets").deleteOne({ id: body.id });
      await db.collection("gem_row_mappings").deleteOne({ sheetId: body.id });
      return NextResponse.json({ success: true });
    }

    if (action === "save_catalogue_links") {
      const firmCode = (body.firmCode || "").toString().trim().toUpperCase();
      if (!firmCode) {
        return NextResponse.json({ error: "firmCode is required" }, { status: 400 });
      }

      const rows = Array.isArray(body) ? body : body.rows;
      const sanitized = sanitizeBody(rows).map((row: any) => ({
        ...row,
        firmCode,
        fetchedAt: new Date().toISOString()
      }));

      // De-duplicate within this firm's batch, keyed by the product's GeM
      // Catalogue Id (falls back to ProductID/Name) - same firm should never
      // have two rows for the same product. Duplicates across different
      // firms are fine and expected (each firm has its own listing).
      const seen = new Map<string, any>();
      for (const row of sanitized) {
        const key = (row["Gem Catalogue Id"]?.text || row["ProductID"]?.text || row["Name"]?.text || "")
          .toString().trim().toLowerCase();
        if (key) seen.set(key, row);
      }
      const deduped = Array.from(seen.values());

      // Preserve previously-fetched stock/min-qty ("Fetch All Stock") data across
      // this re-scan, since the catalogue scrape itself never carries those fields -
      // without this, every "Send to Sync Console" run would wipe them back to empty.
      const existingLinks = await db.collection("gem_catalogue_links").find({ firmCode }).toArray();
      const existingByKey = new Map<string, any>();
      for (const doc of existingLinks) {
        const key = (doc["Gem Catalogue Id"]?.text || doc["ProductID"]?.text || doc["Name"]?.text || "")
          .toString().trim().toLowerCase();
        if (key) existingByKey.set(key, doc);
      }
      for (const row of deduped) {
        const key = (row["Gem Catalogue Id"]?.text || row["ProductID"]?.text || row["Name"]?.text || "")
          .toString().trim().toLowerCase();
        const prior = existingByKey.get(key);
        if (prior) {
          if (prior.currentStock !== undefined) row.currentStock = prior.currentStock;
          if (prior.minQtyPerConsignee !== undefined) row.minQtyPerConsignee = prior.minQtyPerConsignee;
          if (prior.stockFetchedAt !== undefined) row.stockFetchedAt = prior.stockFetchedAt;
        }
      }

      // Only replace this firm's previously synced links - other firms' data stays intact
      await db.collection("gem_catalogue_links").deleteMany({ firmCode });
      if (deduped.length > 0) {
        await db.collection("gem_catalogue_links").insertMany(deduped);
      }
      return NextResponse.json({ success: true, count: deduped.length, firmCode });
    }

    if (action === "save_stock_fields") {
      const firmCode = (body.firmCode || "").toString().trim().toUpperCase();
      const productId = (body.productId || "").toString().trim();
      const catalogueId = (body.catalogueId || "").toString().trim();

      if (!firmCode || (!productId && !catalogueId)) {
        return NextResponse.json({ error: "firmCode and productId/catalogueId are required" }, { status: 400 });
      }

      // Match the catalogue link row this stock page belongs to (same firm,
      // same product), keyed by whichever id we managed to scrape from the page.
      const idFilters: any[] = [];
      if (productId) idFilters.push({ "ProductID.text": productId });
      if (catalogueId) idFilters.push({ "Gem Catalogue Id.text": catalogueId });

      const stockFields = {
        currentStock: body.currentStock ?? null,
        minQtyPerConsignee: body.minQtyPerConsignee ?? null,
        stockFetchedAt: new Date().toISOString()
      };

      const result = await db.collection("gem_catalogue_links").updateMany(
        { firmCode, $or: idFilters },
        { $set: stockFields }
      );

      // Nothing matched - most likely this product's row was never created via
      // "Send to Sync Console" (or the scraped id doesn't exactly match the
      // stored ProductID/Gem Catalogue Id text). Don't silently drop the fetched
      // data - insert a minimal row so it still shows up in OMS.
      let inserted = false;
      if (result.matchedCount === 0) {
        await db.collection("gem_catalogue_links").insertOne({
          firmCode,
          ...(productId ? { ProductID: { text: productId, href: null } } : {}),
          ...(catalogueId ? { "Gem Catalogue Id": { text: catalogueId, href: null } } : {}),
          ...stockFields,
          fetchedAt: new Date().toISOString()
        });
        inserted = true;
      }

      return NextResponse.json({ success: true, matched: result.matchedCount, modified: result.modifiedCount, inserted });
    }

    if (action === "cleanup_unfirmed_catalogue_links") {
      // Removes catalogue links synced before firm-tagging existed (no firmCode)
      const result = await db.collection("gem_catalogue_links").deleteMany({
        $or: [{ firmCode: { $exists: false } }, { firmCode: "" }, { firmCode: null }]
      });
      return NextResponse.json({ success: true, removedCount: result.deletedCount });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("POST gem-sync error:", error);
    return NextResponse.json({ error: "Failed to save state" }, { status: 500 });
  }
}
