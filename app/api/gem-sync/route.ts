import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

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

// GET: Fetch the shared console state from MongoDB (with auto-deduplicated listings)
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db();

    // Fetch collections
    const buyers = await db.collection("gem_buyers").find({}).toArray();
    const rawListings = await db.collection("gem_listings").find({}).toArray();
    const rateHistory = await db.collection("gem_rate_history").find({}).toArray();
    const customItems = await db.collection("gem_custom_items").find({}).toArray();
    const sheets = await db.collection("gem_sheets").find({}).toArray();
    const catalogueLinks = await db.collection("gem_catalogue_links").find({}).toArray();

    // Clean MongoDB _id fields for React/JSON serialization
    const cleanBuyers = buyers.map(({ _id, ...rest }) => ({ ...rest }));
    const cleanListings = rawListings.map(({ _id, ...rest }) => ({ ...rest }));
    const cleanHistory = rateHistory.map(({ _id, ...rest }) => ({ ...rest }));
    const cleanCustomItems = customItems.map(({ _id, ...rest }) => ({ ...rest }));
    const cleanSheets = sheets.map(({ _id, ...rest }) => ({ ...rest }));
    const cleanCatalogueLinks = catalogueLinks.map(({ _id, ...rest }) => ({ ...rest }));

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
      rateHistory: cleanHistory,
      customItems: cleanCustomItems,
      sheets: cleanSheets,
      catalogueLinks: cleanCatalogueLinks
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
      const sanitizedRows = sanitizeBody(body.uploadedRows || []);
      await db.collection("gem_sheets").updateOne(
        { id: body.id },
        {
          $set: {
            id: body.id,
            fileName: body.fileName || "",
            uploadedRows: sanitizedRows,
            originalExcelData: body.originalExcelData || [],
            selectedBuyerId: body.selectedBuyerId || "",
            isCompleted: body.isCompleted !== undefined ? !!body.isCompleted : false,
            lastEditedBy: body.lastEditedBy || "",
            updatedAt: new Date().toISOString()
          },
          // Only stamped the very first time this sheet id is created (the actual
          // upload event) — never overwritten by later edits/saves, unlike lastEditedBy.
          $setOnInsert: {
            uploadedBy: body.uploadedBy || "",
            uploadedAt: new Date().toISOString()
          }
        },
        { upsert: true }
      );
      return NextResponse.json({ success: true });
    }

    if (action === "delete_sheet") {
      if (!body.id) {
        return NextResponse.json({ error: "Sheet ID is required" }, { status: 400 });
      }
      await db.collection("gem_sheets").deleteOne({ id: body.id });
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
