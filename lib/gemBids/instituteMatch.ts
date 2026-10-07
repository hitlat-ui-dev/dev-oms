export interface SellerLite {
  instituteName?: string;
  buyerName?: string;
  gemLocationText?: string;
}

// Mirrors guessBuyerForOrder in app/dashboard/orders/fetch-gem-orders/page.tsx
// (substring-containment either direction, same minimum-length guard
// against a short/generic string hijacking every bid's guess), with two
// changes learned from a real false-positive this caused: a real address
// is itself full of commas as ordinary punctuation ("Institute, Street,
// Taluka, District"), and splitting gemLocationText on comma to support
// multiple variants ended up carving out generic fragments like "Govt.
// Industrial Training Institute" as their own "variant" - long enough to
// pass the length guard, but common to nearly every government ITI's
// address, so it matched (and returned) the wrong institute entirely. A
// seller listing more than one GeM-shown variant now separates them with
// " | " instead, which doesn't collide with normal address text. Second,
// among every candidate that matches at all, the LONGEST (most specific)
// one wins rather than whichever happened to be checked first - a longer
// match is far less likely to be a coincidental generic-phrase collision.
//
// Shared between GemBidTable's Address column and the Bid Rate page (both
// need the exact same guess for the exact same bid) - kept in one place
// after this exact logic needed a real bugfix once already, so it's never
// hand-duplicated and allowed to drift again.
const MIN_INSTITUTE_MATCH_LEN = 8;

export function bestInstituteMatch(
  rawLoc: string,
  sellers: SellerLite[],
  candidatesFor: (s: SellerLite) => string[]
): string | null {
  let best: { name: string; len: number } | null = null;
  for (const s of sellers) {
    const name = s.instituteName || s.buyerName || "";
    if (!name) continue;
    for (const raw of candidatesFor(s)) {
      const candidate = raw.trim().toLowerCase();
      if (candidate.length < MIN_INSTITUTE_MATCH_LEN) continue;
      if (!rawLoc.includes(candidate) && !candidate.includes(rawLoc)) continue;
      if (!best || candidate.length > best.len) best = { name, len: candidate.length };
    }
  }
  return best ? best.name : null;
}

export function guessInstituteForAddress(rawAddress: string, sellers: SellerLite[]): string | null {
  const rawLoc = (rawAddress || "").toLowerCase();
  if (!rawLoc) return null;

  // gemLocationText is the deliberate, GeM-specific signal - tried first,
  // falling back to a plain institute-name match only if nothing there matched.
  const viaLocation = bestInstituteMatch(rawLoc, sellers, (s) => (s.gemLocationText || "").split("|"));
  if (viaLocation) return viaLocation;

  return bestInstituteMatch(rawLoc, sellers, (s) => [s.instituteName || s.buyerName || ""]);
}
