import { extractPayerKeyword } from "@/lib/reconciliation/matchingEngine";

export interface SellerLite {
  instituteName: string;
  statementDescriptionName?: string[];
}

/**
 * Matches a free-text bank statement transaction description against every seller's
 * registered "Statement Description Name" variants (set on the Update Seller page),
 * returning the owning institute's name — or null if nothing matches.
 * The longest matching name wins, so a more specific tag beats a shorter, riskier one.
 * Falls back to a bidirectional prefix match against the UTR/NEFT-extracted payer
 * fragment when the raw description doesn't contain any registered tag outright
 * (e.g. a truncated narration like "DISTRICT TRE") — kept in sync with the real
 * matching engine's findInstituteMatch in lib/reconciliation/matchingEngine.ts.
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
  if (best) return best.instituteName;

  const fragment = extractPayerKeyword(description);
  if (!fragment) return null;
  const fragmentLower = fragment.toLowerCase();
  for (const seller of sellers) {
    for (const raw of seller.statementDescriptionName || []) {
      const candidate = (raw || "").trim().toLowerCase();
      if (candidate.length < 3) continue;
      const isPrefixMatch = candidate.startsWith(fragmentLower) || fragmentLower.startsWith(candidate);
      if (isPrefixMatch && (!best || candidate.length > best.length)) {
        best = { instituteName: seller.instituteName, length: candidate.length };
      }
    }
  }
  return best ? best.instituteName : null;
}
