// Tag <-> Bid item name matching key (spec section 6). Exact normalized match only.
export function normalizeName(s: unknown): string {
  return String(s || "")
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/\bgms?\b|\bgrams?\b/g, "g")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const PRICELIST_DB = "dev_oms_db";
