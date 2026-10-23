import { NextResponse } from "next/server";
import { getPricelistDb } from "@/lib/pricelist/db";

export const runtime = "nodejs";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// GET ?q=: autocomplete = existing tag names + distinct item names used in GeM bids' BOQ.
export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const q = (sp.get("q") || "").trim();
    // scope=received suggests from the Received Purchase tags instead of the pricelist tags
    const tagCollection = sp.get("scope") === "received" ? "received_purchase_tags" : "pricelist_tags";
    if (q.length < 2) return NextResponse.json({ suggestions: [] });
    const { db } = await getPricelistDb();
    const rx = q.split(/\s+/).map((w) => `(?=.*${escapeRegex(w)})`).join("") + ".*";

    const [tagNames, bidNames] = await Promise.all([
      db.collection(tagCollection).aggregate([
        { $match: { tag_name: { $regex: rx, $options: "i" } } },
        { $group: { _id: "$tag_key", name: { $first: "$tag_name" } } },
        { $limit: 8 },
      ]).toArray(),
      db.collection("gem_bids").aggregate([
        { $match: { "boqRates.itemTitle": { $regex: rx, $options: "i" } } },
        { $limit: 300 },
        { $unwind: "$boqRates" },
        { $match: { "boqRates.itemTitle": { $regex: rx, $options: "i" } } },
        { $group: { _id: "$boqRates.itemTitle" } },
        { $limit: 8 },
      ]).toArray(),
    ]);

    const seen = new Set<string>();
    const suggestions: { name: string; source: "tag" | "bid" }[] = [];
    for (const t of tagNames as any[]) {
      seen.add(t.name.toLowerCase());
      suggestions.push({ name: t.name, source: "tag" });
    }
    for (const b of bidNames as any[]) {
      const name = String(b._id || "").trim();
      if (name && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        suggestions.push({ name, source: "bid" });
      }
    }
    return NextResponse.json({ suggestions });
  } catch (error: any) {
    console.error("Pricelist tag suggest error:", error);
    return NextResponse.json({ suggestions: [] });
  }
}
