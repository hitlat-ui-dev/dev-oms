export interface SellerLite {
  instituteName: string;
  statementDescriptionName?: string[];
}

/**
 * Matches a free-text bank statement transaction description against every seller's
 * registered "Statement Description Name" variants (set on the Update Seller page),
 * returning the owning institute's name — or null if nothing matches.
 * The longest matching name wins, so a more specific tag beats a shorter, riskier one.
 */
export function matchInstituteFromDescription(description: string, sellers: SellerLite[]): string | null {
  const desc = (description || "").toLowerCase();
  if (!desc) return null;

  let best: { instituteName: string; length: number } | null = null;
  for (const seller of sellers) {
    for (const raw of seller.statementDescriptionName || []) {
      const candidate = (raw || "").trim().toLowerCase();
      if (candidate.length < 3) continue; // skip trivial/too-short tags that would false-match everything
      if (desc.includes(candidate) && (!best || candidate.length > best.length)) {
        best = { instituteName: seller.instituteName, length: candidate.length };
      }
    }
  }
  return best ? best.instituteName : null;
}
