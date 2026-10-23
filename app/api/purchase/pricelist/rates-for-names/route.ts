import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { getPricelistDb } from "@/lib/pricelist/db";
import { normalizeName } from "@/lib/pricelist/normalize";
import { compactKey, similarity, SUGGEST_MIN_SCORE } from "@/lib/pricelist/match";

export const runtime = "nodejs";

type Db = Awaited<ReturnType<typeof getPricelistDb>>["db"];

async function loadPricelistRates(db: Db, tagKeys: string[]) {
  const out: Record<string, any[]> = {};
  if (tagKeys.length === 0) return out;
  const links = await db.collection("pricelist_tags").find({ tag_key: { $in: tagKeys } }).toArray();
  if (links.length === 0) return out;
  const items = await db
    .collection("pricelist_items")
    .find({ sku_key: { $in: Array.from(new Set(links.map((l: any) => l.sku_key))) } })
    .project({ search_text: 0, price_history: 0 })
    .toArray();
  const bySku = new Map(items.map((i: any) => [i.sku_key, i]));
  const lists = await db
    .collection("pricelists")
    .find({ _id: { $in: items.map((i: any) => i.pricelist_id) } })
    .project({ uploaded_at: 1 })
    .toArray();
  const uploadedAt = new Map(lists.map((p: any) => [String(p._id), p.uploaded_at]));
  for (const l of links as any[]) {
    const it: any = bySku.get(l.sku_key);
    if (!it) continue;
    (out[l.tag_key] ||= []).push({
      sku_key: it.sku_key,
      rate: it.unit_price_incl_gst,
      brand: it.brand,
      supplier_name: it.supplier_name,
      price: it.price,
      price_qty: it.price_qty,
      discount_pct: it.discount_pct,
      gst_pct: it.gst_pct,
      gst_included: it.gst_included,
      valid_from: it.valid_from,
      price_status: it.price_status,
      is_active: it.is_active,
      uploaded_at: uploadedAt.get(String(it.pricelist_id)) || null,
    });
  }
  return out;
}

async function loadReceivedRates(db: Db, tagKeys: string[]) {
  const out: Record<string, any[]> = {};
  if (tagKeys.length === 0) return out;
  const links = await db.collection("received_purchase_tags").find({ tag_key: { $in: tagKeys } }).toArray();
  if (links.length === 0) return out;
  const client = await clientPromise;
  const latest = await client
    .db()
    .collection("Received purchase")
    .aggregate([
      { $match: { sku: { $in: Array.from(new Set(links.map((l: any) => l.sku))) }, rate: { $gt: 0 } } },
      { $sort: { receivedAt: -1 } },
      { $group: { _id: "$sku", rate: { $first: "$rate" }, vendor: { $first: "$vendor" }, itemName: { $first: "$itemName" }, receivedAt: { $first: "$receivedAt" } } },
    ])
    .toArray();
  const bySku = new Map(latest.map((r: any) => [r._id, r]));
  for (const l of links as any[]) {
    const r: any = bySku.get(l.sku);
    if (!r) continue;
    (out[l.tag_key] ||= []).push({ sku: l.sku, rate: r.rate, vendor: r.vendor || "", itemName: r.itemName || "", receivedAt: r.receivedAt || null });
  }
  return out;
}

const sortPricelist = (list: any[]) =>
  list.sort((a, b) => {
    // active+priced first, then cheapest; inactive/on-request sink to the bottom
    const rank = (x: any) => (x.is_active && x.rate !== null ? 0 : x.is_active ? 1 : 2);
    return rank(a) - rank(b) || (a.rate ?? 0) - (b.rate ?? 0);
  });

// POST { names: [] } -> { rates, received, suggestions }, all keyed by normalizeName(name). One call per bid page.
//  rates       = supplier pricelist rates of items tagged with a matching name
//  received    = latest positive Received Purchase rate per tagged sku (what we actually paid)
//  suggestions = near-misses (similarity >= SUGGEST_MIN_SCORE) for names with no match in that source;
//                shown as hints only, never linked automatically
// "Matching" ignores case, spaces and punctuation (compactKey), so "PVC Elbow 3/4" == "pvcelbow 3.4".
export async function POST(req: Request) {
  try {
    const { names } = await req.json();
    if (!Array.isArray(names)) return NextResponse.json({ error: "names must be an array" }, { status: 400 });
    const keys = Array.from(new Set(names.map(normalizeName).filter(Boolean)));
    if (keys.length === 0) return NextResponse.json({ rates: {}, received: {}, suggestions: {} });

    const { db } = await getPricelistDb();
    const [plTags, recTags] = await Promise.all([
      db.collection("pricelist_tags").aggregate([{ $group: { _id: "$tag_key", name: { $first: "$tag_name" } } }]).toArray(),
      db.collection("received_purchase_tags").aggregate([{ $group: { _id: "$tag_key", name: { $first: "$tag_name" } } }]).toArray(),
    ]);
    const plIdx = plTags.map((t: any) => ({ key: t._id as string, name: t.name as string, compact: compactKey(t._id) }));
    const recIdx = recTags.map((t: any) => ({ key: t._id as string, name: t.name as string, compact: compactKey(t._id) }));

    // 1) same name once spaces/punctuation/case are ignored -> real match
    const plMatch = new Map<string, string[]>();
    const recMatch = new Map<string, string[]>();
    const plSuggest = new Map<string, { key: string; name: string; score: number }[]>();
    const recSuggest = new Map<string, { key: string; name: string; score: number }[]>();
    const resolve = (k: string, idx: typeof plIdx, match: Map<string, string[]>, suggest: typeof plSuggest) => {
      const c = compactKey(k);
      const same = idx.filter((t) => t.compact === c).map((t) => t.key);
      if (same.length) return void match.set(k, same);
      // 2) otherwise the closest tags above the threshold become suggestions
      const near = idx
        .map((t) => ({ key: t.key, name: t.name, score: similarity(k, t.key) }))
        .filter((t) => t.score >= SUGGEST_MIN_SCORE)
        .sort((a, b) => b.score - a.score)
        .slice(0, 2);
      if (near.length) suggest.set(k, near);
    };
    for (const k of keys) {
      resolve(k, plIdx, plMatch, plSuggest);
      resolve(k, recIdx, recMatch, recSuggest);
    }

    const plKeysNeeded = Array.from(new Set([...Array.from(plMatch.values()).flat(), ...Array.from(plSuggest.values()).flat().map((s) => s.key)]));
    const recKeysNeeded = Array.from(new Set([...Array.from(recMatch.values()).flat(), ...Array.from(recSuggest.values()).flat().map((s) => s.key)]));
    const [plRates, recRates] = await Promise.all([loadPricelistRates(db, plKeysNeeded), loadReceivedRates(db, recKeysNeeded)]);

    const rates: Record<string, any[]> = {};
    plMatch.forEach((tagKeys, k) => {
      const list = sortPricelist(tagKeys.flatMap((tk) => plRates[tk] || []));
      if (list.length) rates[k] = list;
    });
    const received: Record<string, any[]> = {};
    recMatch.forEach((tagKeys, k) => {
      const list = tagKeys.flatMap((tk) => recRates[tk] || []).sort((a, b) => a.rate - b.rate);
      if (list.length) received[k] = list;
    });

    const suggestions: Record<string, any[]> = {};
    plSuggest.forEach((near, k) => {
      for (const n of near) {
        const best = sortPricelist([...(plRates[n.key] || [])])[0];
        if (best && best.is_active && best.rate !== null) (suggestions[k] ||= []).push({ source: "pricelist", tag_name: n.name, score: n.score, rate: best.rate, label: best.brand || best.supplier_name });
      }
    });
    recSuggest.forEach((near, k) => {
      for (const n of near) {
        const best = [...(recRates[n.key] || [])].sort((a, b) => a.rate - b.rate)[0];
        if (best) (suggestions[k] ||= []).push({ source: "received", tag_name: n.name, score: n.score, rate: best.rate, label: best.vendor });
      }
    });
    for (const k of Object.keys(suggestions)) suggestions[k].sort((a, b) => b.score - a.score);

    return NextResponse.json({ rates, received, suggestions });
  } catch (error: any) {
    console.error("Pricelist rates-for-names error:", error);
    return NextResponse.json({ error: error.message || "Failed to load rates" }, { status: 500 });
  }
}
