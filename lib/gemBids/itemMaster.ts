import { normalizeItemKey } from "@/lib/documentMaker/boqEngine";

/**
 * Shared by /api/gem-bids/boq and /api/gem-bids/item-rates: an
 * alternateName -> canonical itemKey map (see gem_bid_item_master, written
 * by /api/gem-bids/item-master), so a BOQ item typed under an alternate
 * spelling still resolves to the same item's rate history/suggestions as
 * its canonical name does.
 */
export async function getAlternateNameMap(db: any): Promise<Map<string, string>> {
  const masters = await db
    .collection("gem_bid_item_master")
    .find({ alternateNames: { $exists: true, $ne: [] } }, { projection: { itemKey: 1, alternateNames: 1 } })
    .toArray();
  const map = new Map<string, string>();
  for (const m of masters) {
    for (const alt of m.alternateNames || []) {
      const key = normalizeItemKey(alt);
      if (key) map.set(key, m.itemKey);
    }
  }
  return map;
}

/** Resolves a raw item title to its canonical itemKey, following an alternate-name mapping if one exists. */
export function resolveItemKey(itemTitle: string, aliasMap: Map<string, string>): string {
  const rawKey = normalizeItemKey(itemTitle);
  return aliasMap.get(rawKey) || rawKey;
}
