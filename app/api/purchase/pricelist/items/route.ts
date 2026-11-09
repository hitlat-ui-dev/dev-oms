import { NextResponse } from "next/server";
import { getPricelistDb } from "@/lib/pricelist/db";
import { similarity } from "@/lib/pricelist/match";

export const runtime = "nodejs";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Same threshold family as SUGGEST_MIN_SCORE (lib/pricelist/match.ts) - tuned
// a touch looser since this compares single words, not whole names, and the
// AND-across-every-query-word requirement below already guards against
// false positives on its own.
const FUZZY_WORD_MIN_SCORE = 0.65;

function searchTokens(searchText: unknown): string[] {
  return String(searchText || "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// A query word matches a stored item if it's a literal substring of any of
// the item's search_text tokens (unchanged exact behavior), or - for words
// long enough that a bigram comparison is meaningful - if it's a close
// spelling variant of one (e.g. "comparision" vs. the item's "comparison").
function wordFuzzyMatches(word: string, tokens: string[]): boolean {
  if (tokens.some((t) => t.includes(word))) return true;
  if (word.length < 4) return false;
  return tokens.some((t) => t.length >= 4 && similarity(word, t) >= FUZZY_WORD_MIN_SCORE);
}

// GET ?q=&brand=a,b&supplier=&category=&tagged=all|tagged|untagged&tag=<tag_key>&inactive=1&page=1
// q is split on spaces; every word must appear in search_text (AND, case-insensitive).
// If that strict pass finds nothing for a non-blank q, a fallback pass
// allows each word to match by close spelling instead (see wordFuzzyMatches)
// - a GeM BOQ title and a supplier's pricelist entry for the same item
// often differ by exactly this kind of typo (e.g. "Comparision" vs.
// "Comparison"), and a literal AND-substring search has no way to bridge
// that on its own.
export async function GET(req: Request) {
  try {
    const { db } = await getPricelistDb();
    const sp = new URL(req.url).searchParams;
    const q = (sp.get("q") || "").trim().toLowerCase();
    const brands = (sp.get("brand") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const supplier = sp.get("supplier") || "";
    const category = sp.get("category") || "";
    const tagged = sp.get("tagged") || "all";
    const tagKey = sp.get("tag") || "";
    const showInactive = sp.get("inactive") === "1";
    const page = Math.max(1, parseInt(sp.get("page") || "1", 10) || 1);
    const PAGE_SIZE = 50;

    const and: any[] = [];
    const filter: any = {};
    if (!showInactive) filter.is_active = true;
    for (const w of q.split(/\s+/).filter(Boolean)) and.push({ search_text: { $regex: escapeRegex(w) } });
    if (brands.length) filter.brand = { $in: brands };
    if (supplier) filter.supplier_name = supplier;
    if (category) filter.category = category;

    const tags = db.collection("pricelist_tags");
    if (tagKey) {
      and.push({ sku_key: { $in: await tags.distinct("sku_key", { tag_key: tagKey }) } });
    } else if (tagged === "tagged") {
      and.push({ sku_key: { $in: await tags.distinct("sku_key") } });
    } else if (tagged === "untagged") {
      and.push({ sku_key: { $nin: await tags.distinct("sku_key") } });
    }
    if (and.length) filter.$and = and;

    const col = db.collection("pricelist_items");
    let [total, items] = await Promise.all([
      col.countDocuments(filter),
      col
        .find(filter, { projection: { search_text: 0, price_history: 0 } })
        .sort({ category: 1, sub_type: 1, model_no: 1, sku_key: 1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .toArray(),
    ]);

    let fuzzy = false;
    const qWords = q.split(/\s+/).filter(Boolean);
    if (total === 0 && qWords.length) {
      // Re-run every other filter (brand/supplier/category/tagged/active) with
      // no q constraint, then score each candidate's search_text in app code -
      // the collection is small enough (a few thousand rows) that this is
      // cheap, and it's only ever reached once the strict pass above already
      // came up empty.
      const fallbackFilter: any = { ...filter };
      delete fallbackFilter.$and;
      const nonQAnd = and.filter((clause) => !("search_text" in clause));
      if (nonQAnd.length) fallbackFilter.$and = nonQAnd;

      const candidates = await col
        .find(fallbackFilter, { projection: { price_history: 0 } })
        .toArray();
      const scored = candidates
        .map((c: any) => {
          const tokens = searchTokens(c.search_text);
          if (!qWords.every((w) => wordFuzzyMatches(w, tokens))) return null;
          const score =
            qWords.reduce((sum, w) => {
              if (tokens.some((t) => t.includes(w))) return sum + 1;
              const best = tokens.reduce((m, t) => Math.max(m, similarity(w, t)), 0);
              return sum + best;
            }, 0) / qWords.length;
          delete c.search_text;
          return { c, score };
        })
        .filter((x): x is { c: any; score: number } => x !== null)
        .sort((a, b) => b.score - a.score);

      fuzzy = scored.length > 0;
      total = scored.length;
      items = scored.slice((page - 1) * PAGE_SIZE, (page - 1) * PAGE_SIZE + PAGE_SIZE).map((s) => s.c);
    }

    const tagDocs = items.length
      ? await tags.find({ sku_key: { $in: items.map((i: any) => i.sku_key) } }).sort({ created_at: 1 }).toArray()
      : [];
    const tagsBySku = new Map<string, any[]>();
    for (const t of tagDocs as any[]) {
      const list = tagsBySku.get(t.sku_key) || [];
      list.push({ _id: String(t._id), tag_name: t.tag_name, tag_key: t.tag_key });
      tagsBySku.set(t.sku_key, list);
    }

    let facets: any = undefined;
    if (sp.get("facets") === "1") {
      const [b, s, c] = await Promise.all([
        col.distinct("brand", { is_active: true }),
        col.distinct("supplier_name", { is_active: true }),
        col.distinct("category", { is_active: true }),
      ]);
      const clean = (a: any[]) => a.filter(Boolean).sort((x, y) => String(x).localeCompare(String(y)));
      facets = { brands: clean(b), suppliers: clean(s), categories: clean(c) };
    }

    return NextResponse.json({
      total,
      page,
      pageSize: PAGE_SIZE,
      // True when the strict AND-substring pass found nothing and these
      // results came from the spelling-fuzzy fallback instead - lets a
      // caller (e.g. BidItemTagDialog) flag them as approximate matches.
      fuzzy,
      items: items.map((i: any) => ({ ...i, _id: String(i._id), pricelist_id: String(i.pricelist_id), tags: tagsBySku.get(i.sku_key) || [] })),
      facets,
    });
  } catch (error: any) {
    console.error("Pricelist items error:", error);
    return NextResponse.json({ error: error.message || "Search failed" }, { status: 500 });
  }
}

const UNITS = ["Each", "Set", "Pair", "Pack", "Kg"];
const PRICE_TYPES = ["LIST", "MRP", "DEALER", "NET"];
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const s = (v: any) => String(v ?? "").trim();
const n = (v: any) => {
  const c = String(v ?? "").replace(/[₹,\s]/g, "");
  return c === "" ? null : /^-?\d*\.?\d+$/.test(c) ? Number(c) : NaN;
};

// POST: add one item by hand (Upload tab form). Same recalculation rules as the xlsx upload.
// Stored with source:"manual" so a later supplier upload does not deactivate it.
export async function POST(req: Request) {
  try {
    const b = await req.json();
    const errors: string[] = [];
    const category = s(b.category);
    if (!category) errors.push("Category is required");
    const unit = s(b.unit);
    if (!UNITS.includes(unit)) errors.push(`Unit must be one of ${UNITS.join(", ")}`);
    const priceType = s(b.price_type || "LIST").toUpperCase();
    if (!PRICE_TYPES.includes(priceType)) errors.push("Invalid price type");
    const gstIncluded = s(b.gst_included || "NO").toUpperCase();
    if (!["YES", "NO"].includes(gstIncluded)) errors.push("GST included must be YES or NO");
    const priceStatus = s(b.price_status || "PRICED").toUpperCase();
    if (!["PRICED", "ON_REQUEST"].includes(priceStatus)) errors.push("Invalid price status");
    const onRequest = priceStatus === "ON_REQUEST";
    const supplier = s(b.supplier_name);
    if (!supplier) errors.push("Supplier name is required");
    const validFrom = s(b.valid_from) || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom) || isNaN(new Date(validFrom).getTime())) errors.push("Valid from must be YYYY-MM-DD");

    const price = n(b.price);
    if (!onRequest && (price === null || Number.isNaN(price) || price < 0)) errors.push("Price must be a number >= 0");
    let priceQty = n(b.price_qty);
    if (priceQty === null) priceQty = 1;
    if (Number.isNaN(priceQty) || priceQty <= 0) errors.push("Price qty must be > 0");
    let disc = n(b.discount_pct);
    if (disc === null) disc = 0;
    if (Number.isNaN(disc) || disc < 0 || disc > 100) errors.push("Discount must be 0-100");
    const gst = n(b.gst_pct);
    if (!onRequest && (gst === null || Number.isNaN(gst) || gst < 0)) errors.push("GST % is required");
    if (errors.length) return NextResponse.json({ error: errors.join("; ") }, { status: 400 });

    const { db } = await getPricelistDb();
    let sku = s(b.sku_key);
    if (!sku) sku = `MAN-${Date.now().toString(36).toUpperCase()}`;
    const supplierCode = sku.split("-")[0].trim().toUpperCase();
    if (await db.collection("pricelist_items").findOne({ sku_key: sku })) {
      return NextResponse.json({ error: `SKU ${sku} already exists` }, { status: 409 });
    }

    let unitPrice: number | null = null, net: number | null = null, incl: number | null = null, finalPrice: number | null = null;
    if (!onRequest && price !== null) {
      finalPrice = price as number;
      unitPrice = round2(finalPrice / (priceQty as number));
      net = round2(unitPrice * (1 - (disc as number) / 100));
      incl = gstIncluded === "YES" ? net : round2(net * (1 + ((gst as number) || 0) / 100));
    }
    const doc: any = {
      sku_key: sku, category, sub_type: s(b.sub_type), model_no: s(b.model_no), size_spec: s(b.size_spec), variant: s(b.variant),
      unit, price: finalPrice, price_qty: priceQty, unit_price: unitPrice, discount_pct: disc, net_unit_price: net,
      gst_pct: gst, unit_price_incl_gst: incl, price_type: priceType, gst_included: gstIncluded, price_status: priceStatus,
      pack_qty: n(b.pack_qty), supplier_name: supplier, brand: s(b.brand), valid_from: validFrom, source_page: null,
    };
    doc.search_text = [doc.sku_key, doc.category, doc.sub_type, doc.model_no, doc.size_spec, doc.variant, doc.brand, doc.supplier_name].join(" ").toLowerCase();
    const now = new Date();
    await db.collection("pricelist_items").insertOne({
      ...doc, supplier_code: supplierCode, pricelist_id: null, source: "manual", is_active: true,
      price_history: [{ pricelist_id: null, valid_from: validFrom, unit_price_incl_gst: incl }],
      created_by: s(b.userName), created_at: now, updated_at: now,
    });
    return NextResponse.json({ ok: true, sku_key: sku });
  } catch (error: any) {
    console.error("Pricelist manual add error:", error);
    return NextResponse.json({ error: error.message || "Failed to add item" }, { status: 500 });
  }
}

// PATCH: edit one existing item's rate/terms in place - a targeted partial
// update, by request, so revising a handful of items' prices doesn't mean
// re-uploading (and thereby auto-deactivating the rest of) the whole
// supplier catalog the way a full xlsx upload does. Identity fields
// (category/sku/supplier etc.) aren't editable here - a change to those is
// a different item, not a rate revision. Same recalculation rules as POST.
export async function PATCH(req: Request) {
  try {
    const b = await req.json();
    const sku = s(b.sku_key);
    if (!sku) return NextResponse.json({ error: "sku_key is required" }, { status: 400 });

    const { db } = await getPricelistDb();
    const existing: any = await db.collection("pricelist_items").findOne({ sku_key: sku });
    if (!existing) return NextResponse.json({ error: `SKU ${sku} not found` }, { status: 404 });

    const errors: string[] = [];
    const priceStatus = s(b.price_status ?? existing.price_status ?? "PRICED").toUpperCase();
    if (!["PRICED", "ON_REQUEST"].includes(priceStatus)) errors.push("Invalid price status");
    const onRequest = priceStatus === "ON_REQUEST";
    const gstIncluded = s(b.gst_included ?? existing.gst_included ?? "NO").toUpperCase();
    if (!["YES", "NO"].includes(gstIncluded)) errors.push("GST included must be YES or NO");
    const validFrom = s(b.valid_from) || existing.valid_from;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom) || isNaN(new Date(validFrom).getTime())) errors.push("Valid from must be YYYY-MM-DD");

    const price = b.price === undefined || b.price === "" ? existing.price : n(b.price);
    if (!onRequest && (price === null || Number.isNaN(price as number) || (price as number) < 0)) errors.push("Price must be a number >= 0");
    let priceQty = b.price_qty === undefined || b.price_qty === "" ? existing.price_qty : n(b.price_qty);
    if (priceQty === null) priceQty = 1;
    if (Number.isNaN(priceQty) || (priceQty as number) <= 0) errors.push("Price qty must be > 0");
    let disc = b.discount_pct === undefined || b.discount_pct === "" ? existing.discount_pct : n(b.discount_pct);
    if (disc === null) disc = 0;
    if (Number.isNaN(disc) || (disc as number) < 0 || (disc as number) > 100) errors.push("Discount must be 0-100");
    const gst = b.gst_pct === undefined || b.gst_pct === "" ? existing.gst_pct : n(b.gst_pct);
    if (!onRequest && (gst === null || Number.isNaN(gst as number) || (gst as number) < 0)) errors.push("GST % is required");
    if (errors.length) return NextResponse.json({ error: errors.join("; ") }, { status: 400 });

    let unitPrice: number | null = null, net: number | null = null, incl: number | null = null, finalPrice: number | null = null;
    if (!onRequest && price !== null) {
      finalPrice = price as number;
      unitPrice = round2(finalPrice / (priceQty as number));
      net = round2(unitPrice * (1 - (disc as number) / 100));
      incl = gstIncluded === "YES" ? net : round2(net * (1 + ((gst as number) || 0) / 100));
    }

    const now = new Date();
    const update: any = {
      $set: {
        price: finalPrice, price_qty: priceQty, unit_price: unitPrice, discount_pct: disc,
        net_unit_price: net, gst_pct: gst, unit_price_incl_gst: incl, gst_included: gstIncluded,
        price_status: priceStatus, valid_from: validFrom, updated_by: s(b.userName), updated_at: now,
      },
    };
    if (incl !== existing.unit_price_incl_gst) {
      update.$push = { price_history: { pricelist_id: existing.pricelist_id ?? null, valid_from: validFrom, unit_price_incl_gst: incl } };
    }
    await db.collection("pricelist_items").updateOne({ sku_key: sku }, update);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("Pricelist item edit error:", error);
    return NextResponse.json({ error: error.message || "Failed to update item" }, { status: 500 });
  }
}
