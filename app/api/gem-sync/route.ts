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

    // gem_catalogue_links is the raw browser-extension-scraped GeM catalogue —
    // by far the largest/slowest collection here, and only the dedicated
    // /dashboard/gem-sync/catalogue page ever needs it. Fetched only on
    // ?catalogue=1 so the main console's every-visit load skips it entirely.
    if (searchParams.get("catalogue")) {
      const [catalogueLinks, rawListings] = await Promise.all([
        db.collection("gem_catalogue_links").find({}).toArray(),
        db.collection("gem_listings").find({}).toArray(),
      ]);
      const cleanCatalogueLinks = catalogueLinks.map(({ _id, ...rest }) => ({ ...rest }));
      const cleanListings = rawListings.map(({ _id, ...rest }) => ({ ...rest }));
      return NextResponse.json({
        catalogueLinks: cleanCatalogueLinks,
        listings: deduplicateListings(cleanListings),
      });
    }

    // Fetch the remaining collections concurrently rather than one-at-a-time —
    // total wait becomes the slowest single query instead of the sum of all of them.
    const [buyers, rawListings, customItems, sheets, rowMappings, newLinkChecklist] = await Promise.all([
      db.collection("gem_buyers").find({}).toArray(),
      db.collection("gem_listings").find({}).toArray(),
      db.collection("gem_custom_items").find({}).toArray(),
      db.collection("gem_sheets").find({}).toArray(),
      // Lightweight (originalName + mappedItemId only) per-sheet mapping history —
      // powers "Quick Fill from Master List" across all past sheets without
      // needing every sheet's full uploadedRows (which now live in R2).
      db.collection("gem_row_mappings").find({}).toArray(),
      // "New Upload Link" checklist portion - items that are completely new
      // for a firm (no existing GeM listing yet), pushed here from the
      // Requirement Mapping Console's "Add New Link" button. Separate from
      // gem_listings (the "Stock Update" checklist portion), since these
      // entries don't necessarily have a rate/inventory mapping yet.
      db.collection("gem_new_link_checklist").find({}).toArray(),
    ]);

    // Clean MongoDB _id fields for React/JSON serialization
    const cleanBuyers = buyers.map(({ _id, ...rest }) => ({ ...rest }));
    const cleanListings = rawListings.map(({ _id, ...rest }) => ({ ...rest }));
    const cleanCustomItems = customItems.map(({ _id, ...rest }) => ({ ...rest }));
    const cleanSheets = sheets.map(({ _id, ...rest }) => ({ ...rest }));
    const cleanRowMappings = rowMappings.map(({ _id, ...rest }) => ({ ...rest }));
    const cleanNewLinkChecklist = newLinkChecklist.map(({ _id, ...rest }) => ({ ...rest }));

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
      rowMappings: cleanRowMappings,
      newLinkChecklist: cleanNewLinkChecklist
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

    // Append-only log of every Requirement Mapping Console row action (OK
    // Link / Update Stock / New Link) - powers the GeM Sync report on the
    // Summary dashboard. Never overwritten/deleted by normal use, so counts
    // are a durable all-time record, not tied to any one sheet or session.
    if (action === "log_gem_action") {
      const type = body.type;
      if (!["ok_link", "update_stock", "new_link"].includes(type)) {
        return NextResponse.json({ error: "type must be ok_link, update_stock, or new_link" }, { status: 400 });
      }
      await db.collection("gem_action_log").insertOne({
        id: "action_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
        type,
        itemName: body.itemName || "",
        firmCode: body.firmCode || "",
        requiredQty: body.requiredQty ?? null,
        rate: body.rate ?? null,
        by: body.by || "",
        sheetFileName: body.sheetFileName || "",
        timestamp: new Date().toISOString(),
      });
      return NextResponse.json({ success: true });
    }

    // Called by the gem-bill-submit browser extension once it's actually
    // pushed a Rate/Stock/Min Qty update through to GeM's own catalogue - no
    // OMS login session available from there, so this is a plain POST action
    // keyed by the listing's own id, same pattern as
    // save_stock_fields/save_catalogue_links.
    if (action === "mark_listing_synced") {
      const id = (body.id || "").toString().trim();
      if (!id) {
        return NextResponse.json({ error: "id is required" }, { status: 400 });
      }
      const result = await db.collection("gem_listings").updateOne({ id }, { $set: { status: "Synced" } });
      if (result.matchedCount === 0) {
        return NextResponse.json({ error: `No listing found for id=${id}.` }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    }

    if (action === "save_new_link_checklist") {
      await db.collection("gem_new_link_checklist").deleteMany({});
      const sanitized = sanitizeBody(body);
      if (sanitized.length > 0) {
        await db.collection("gem_new_link_checklist").insertMany(sanitized);
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
      let persistContent = hasContent;
      if (hasContent) {
        sanitizedRows = sanitizeBody(body.uploadedRows);

        // A racy auto-save (debounced effect firing on stale/still-loading
        // state — see page.tsx) can land here with fewer rows than the sheet
        // already has saved, right down to a completely empty array.
        // Confirmed live: several Sheet Library rows got permanently stuck
        // at "0" total items this way. No legitimate flow in this app ever
        // shrinks an EXISTING sheet id's row count — a fresh upload/rebuild
        // always gets a brand-new id (Date.now()-based), and there's no
        // per-row delete once a sheet is uploaded — so a save carrying fewer
        // rows than what's on file is always a stale/racy write, never a
        // deliberate edit. Once a sheet has N rows saved, the only way its
        // content actually shrinks is the user pressing Delete Sheet
        // (action=delete_sheet, its own explicit confirm() step below) —
        // never a silent auto-save.
        const existing = await db.collection("gem_sheets").findOne({ id: body.id }, { projection: { totalRows: 1 } });
        if (existing && sanitizedRows.length < (existing.totalRows || 0)) {
          persistContent = false;
        }
      }

      if (persistContent) {
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
          ...(persistContent ? { $unset: { uploadedRows: "", originalExcelData: "" } } : {})
        },
        { upsert: true }
      );

      if (persistContent) {
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

    // Links one GeM Catalogue row to an internal inventory item, creating a
    // new Master List (gem_listings) entry. Uses gemCatalogueId+firmCode as
    // the identity (not itemId+firmCode+buyerId like the general listings
    // dedup does) so the auto-sync below can find this entry again on every
    // future catalogue/stock re-fetch, purely from GeM's own product id -
    // no buyer/requirement context needed for that.
    if (action === "add_to_master_list") {
      const gemCatalogueId = (body.gemCatalogueId || "").toString().trim();
      const firmCode = (body.firmCode || "").toString().trim();
      const itemId = (body.itemId || "").toString().trim();

      if (!gemCatalogueId || !firmCode || !itemId) {
        return NextResponse.json({ error: "gemCatalogueId, firmCode and itemId are required" }, { status: 400 });
      }

      const existing = await db.collection("gem_listings").findOne({
        gemCatalogueId: { $regex: `^${gemCatalogueId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
        firmCode,
      });
      if (existing) {
        return NextResponse.json({ error: "This product is already in the Master List for this firm." }, { status: 409 });
      }

      const newListing = {
        id: "listing_" + Date.now(),
        gemCatalogueId,
        firmCode,
        itemId,
        itemName: body.itemName || "",
        gemLink: body.gemLink || "",
        rate: Number(body.rate) || 0,
        availGemStock: Number(body.availGemStock) || 0,
        minQty: Number(body.minQty) || 1,
        status: "Synced",
        buyerId: "",
        date: new Date().toISOString(),
      };
      await db.collection("gem_listings").insertOne(newListing);
      return NextResponse.json({ success: true, listing: newListing });
    }

    // Bulk-matches every GeM Catalogue row against the Master List by EXACT
    // identity only - GeM's own Product ID (the "Gem Catalogue Id"/ProductID
    // field, e.g. "5116877-82744993124" from a URL like
    // .../p-5116877-82744993124-cat.html) plus firmCode. No name-similarity
    // guessing here - a listing only gets matched if it's already tagged
    // with this exact product id for this exact firm (via "Add to Master
    // List" or a past run of this action), so there is zero risk of two
    // different products getting cross-matched.
    if (action === "sync_master_list_from_catalogue") {
      const [catalogueLinks, listings] = await Promise.all([
        db.collection("gem_catalogue_links").find({}).toArray(),
        db.collection("gem_listings").find({ gemCatalogueId: { $exists: true, $ne: "" } }).toArray(),
      ]);

      const listingByKey = new Map<string, any>();
      for (const listing of listings) {
        const key = `${listing.gemCatalogueId.toString().trim().toLowerCase()}::${(listing.firmCode || "").toString().trim().toLowerCase()}`;
        listingByKey.set(key, listing);
      }

      let updated = 0;
      let unmatched = 0;

      for (const row of catalogueLinks) {
        const catalogueId = (row["Gem Catalogue Id"]?.text || row["ProductID"]?.text || "").toString().trim();
        const firmCode = (row.firmCode || "").toString().trim();
        if (!catalogueId || !firmCode) { unmatched++; continue; }

        const listing = listingByKey.get(`${catalogueId.toLowerCase()}::${firmCode.toLowerCase()}`);
        if (!listing) { unmatched++; continue; }

        const setFields: any = {};
        const priceText = row["Offer Price"]?.text;
        const rate = priceText ? parseFloat(String(priceText).replace(/[^0-9.]/g, "")) : NaN;
        if (!isNaN(rate)) setFields.rate = rate;
        if (row.currentStock !== undefined && row.currentStock !== null) setFields.availGemStock = row.currentStock;
        if (row.minQtyPerConsignee !== undefined && row.minQtyPerConsignee !== null) setFields.minQty = row.minQtyPerConsignee;

        if (Object.keys(setFields).length > 0) {
          await db.collection("gem_listings").updateOne({ id: listing.id }, { $set: setFields });
          updated++;
        }
      }

      return NextResponse.json({
        success: true,
        updated,
        unmatched,
        totalCatalogueRows: catalogueLinks.length,
      });
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

      // Auto-sync: any Master List entry already linked to one of these
      // products (via "Add to Master List" on the Catalogue page) gets its
      // price refreshed from this fresh scrape - never itemId/itemName/other
      // fields, since those represent a human's inventory mapping decision,
      // not scraped data.
      for (const row of deduped) {
        const catalogueId = (row["Gem Catalogue Id"]?.text || row["ProductID"]?.text || "").toString().trim();
        const priceText = row["Offer Price"]?.text;
        const rate = priceText ? parseFloat(String(priceText).replace(/[^0-9.]/g, "")) : NaN;
        if (catalogueId && !isNaN(rate)) {
          await db.collection("gem_listings").updateMany({ gemCatalogueId: catalogueId, firmCode }, { $set: { rate } });
        }
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

      // Auto-sync: refresh availGemStock/minQty on any Master List entry
      // already linked to this product - same rule as save_catalogue_links
      // above (only these scraped fields, never the inventory mapping).
      const syncKey = catalogueId || productId;
      if (syncKey) {
        const setFields: any = {};
        if (body.currentStock !== undefined && body.currentStock !== null) setFields.availGemStock = body.currentStock;
        if (body.minQtyPerConsignee !== undefined && body.minQtyPerConsignee !== null) setFields.minQty = body.minQtyPerConsignee;
        if (Object.keys(setFields).length > 0) {
          await db.collection("gem_listings").updateMany({ gemCatalogueId: syncKey, firmCode }, { $set: setFields });
        }
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
