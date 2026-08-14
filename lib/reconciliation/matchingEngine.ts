import type { Db } from "mongodb";

// ============================================================
// TYPES
// ============================================================

export interface AliasMeta {
  keyword: string;
  confidence: number;
  lastUsed?: Date;
  source?: "manual_seed" | "learned";
}

export interface NegativeKeyword {
  keyword: string;
  rejectedCount: number;
}

export interface DeductionProfile {
  tdsOnlyCount: number;
  tdsGstCount: number;
  kasarCount: number;
  kasarRange: { min: number | null; max: number | null };
  lastConfirmedType: string | null;
}

// Minimal shape the matching engine needs from a Seller ("Institute") doc —
// deliberately loose (matches this codebase's convention of `any` for Mongoose docs).
export interface SellerForMatching {
  _id?: any;
  instituteName: string;
  statementDescriptionName?: string[];
  aliasMeta?: AliasMeta[];
  negativeKeywords?: NegativeKeyword[];
  deductionProfile?: DeductionProfile;
  autoApproveTrusted?: boolean;
}

export type ConfidenceLabel = "high" | "low" | "new";

export interface InstituteMatchResult {
  instituteName: string;
  sellerId: any;
  matchedKeyword: string;
  confidence: number;
  confidenceLabel: ConfidenceLabel;
}

export type DeductionType = "TDS" | "TDS+GST" | "Kasar";

export interface BillMatchResult {
  bill: any;
  remainingAmount: number;
  deductionAmount: number;
  matchType: "exact" | "deduction";
}

export interface CombinationMatchResult {
  bills: any[];
  totalAmount: number;
  matchType: "combination";
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ============================================================
// KEYWORD EXTRACTION (ported from the provided learning-engine.js)
// ============================================================

const STOPWORDS = new Set([
  "neft", "imps", "rtgs", "upi", "utr", "transfer", "credit", "cr",
  "dr", "txn", "trn", "ref", "to", "from", "by", "the", "and", "of",
  "in", "at", "for", "a", "an", "on", "via", "payment", "pymt", "pmt",
]);

export function normalizeText(text?: string): string {
  return (text || "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extracts candidate keyword(s) from a bank-statement description for learning a new alias. */
export function extractKeywords(description?: string): string[] {
  if (!description) return [];
  const normalized = normalizeText(description);

  const tokens = normalized.split(" ").filter((token) => {
    if (token.length < 3) return false;
    if (STOPWORDS.has(token.toLowerCase())) return false;
    if (/^\d+$/.test(token)) return false;
    return true;
  });
  if (tokens.length === 0) return [];

  const candidates = new Set<string>();
  const longest = [...tokens].sort((a, b) => b.length - a.length)[0];
  candidates.add(longest);
  if (tokens.length >= 2) candidates.add(tokens.slice(0, 2).join(" "));
  if (tokens.length >= 3) candidates.add(tokens.slice(0, 3).join(" "));

  return [...candidates];
}

// ============================================================
// STEP 1 — INSTITUTE MATCH
// ============================================================

/**
 * Richer sibling of lib/institutMatcher.ts's matchInstituteFromDescription: also honors
 * per-institute negativeKeywords (past rejections) and returns confidence info instead
 * of just the institute name, so the caller can persist a scored suggestion.
 */
export function findInstituteMatch(
  description: string,
  sellers: SellerForMatching[]
): InstituteMatchResult | null {
  const desc = (description || "").toLowerCase();
  if (!desc) return null;

  let best: {
    instituteName: string;
    sellerId: any;
    matchedKeyword: string;
    length: number;
    confidence: number;
    hasMeta: boolean;
  } | null = null;

  for (const seller of sellers) {
    const negatives = new Set(
      (seller.negativeKeywords || []).map((n) => (n.keyword || "").trim().toLowerCase())
    );
    for (const raw of seller.statementDescriptionName || []) {
      const candidate = (raw || "").trim().toLowerCase();
      if (candidate.length < 3) continue;
      if (negatives.has(candidate)) continue;
      if (!desc.includes(candidate)) continue;
      if (best && candidate.length <= best.length) continue;

      const meta = (seller.aliasMeta || []).find(
        (a) => (a.keyword || "").trim().toLowerCase() === candidate
      );
      best = {
        instituteName: seller.instituteName,
        sellerId: seller._id,
        matchedKeyword: raw,
        length: candidate.length,
        confidence: meta ? meta.confidence : 1,
        hasMeta: !!meta,
      };
    }
  }

  if (!best) return null;
  const confidenceLabel: ConfidenceLabel =
    best.confidence >= 3 ? "high" : best.hasMeta ? "low" : "new";

  return {
    instituteName: best.instituteName,
    sellerId: best.sellerId,
    matchedKeyword: best.matchedKeyword,
    confidence: best.confidence,
    confidenceLabel,
  };
}

// ============================================================
// STEP 2 — OPEN BILLS + AMOUNT MATCH
// ============================================================

// Every SellerOrder status is eligible for payment matching except the return
// family — a returned/cancelled order is never something an institute still owes on.
export const ELIGIBLE_BILL_STATUSES = [
  "TO CHECK",
  "READY TO SHIP",
  "DELIVERY",
  "FULFILLED",
  "HISAB",
];

export async function findOpenBills(
  db: Db,
  { instituteName, firmCode }: { instituteName: string; firmCode?: string }
): Promise<any[]> {
  const query: any = {
    instituteName,
    isPaid: { $ne: true },
    status: { $in: ELIGIBLE_BILL_STATUSES },
  };
  if (firmCode) query.firmCode = firmCode;
  return db.collection("sellerorders").find(query).sort({ contractDate: 1 }).toArray();
}

const withRemaining = (bills: any[]) =>
  bills.map((b) => ({
    ...b,
    remainingAmount: round2(Number(b.totalAmount || 0) - Number(b.paidAmount || 0)),
  }));

/**
 * Step 2: match a credited amount to a single open bill, within ±tolerance for a full
 * settlement, or — if the credited amount is somewhat short (up to 20%) — the closest
 * bill by deduction size, so Step 3 can classify what was deducted.
 */
export function findAmountMatch(
  bills: any[],
  creditedAmount: number,
  tolerance = 5
): BillMatchResult | null {
  const candidates = withRemaining(bills);

  const exact = candidates.find((b) => Math.abs(b.remainingAmount - creditedAmount) <= tolerance);
  if (exact) {
    return { bill: exact, remainingAmount: exact.remainingAmount, deductionAmount: 0, matchType: "exact" };
  }

  const shortPaid = candidates
    .filter((b) => creditedAmount < b.remainingAmount - tolerance && creditedAmount >= b.remainingAmount * 0.8)
    .map((b) => ({ ...b, deductionAmount: round2(b.remainingAmount - creditedAmount) }))
    .sort((a, b) => a.deductionAmount - b.deductionAmount);

  if (shortPaid.length > 0) {
    const best = shortPaid[0];
    return { bill: best, remainingAmount: best.remainingAmount, deductionAmount: best.deductionAmount, matchType: "deduction" };
  }

  return null;
}

/**
 * Fallback when no single bill fits: a bounded subset-sum search across the institute's
 * open bills for a combination whose total lands within ±tolerance of the credited amount
 * (e.g. one payment settling several small bills at once, no deduction).
 */
export function findCombinationMatch(
  bills: any[],
  creditedAmount: number,
  tolerance = 5,
  maxCombo = 4
): CombinationMatchResult | null {
  const candidates = withRemaining(bills)
    .filter((b) => b.remainingAmount > 0)
    .slice(0, 25); // bound the search space

  const n = candidates.length;
  if (n < 2) return null;

  let found: any[] | null = null;

  const search = (startIdx: number, chosen: any[], sum: number) => {
    if (found) return;
    if (chosen.length > 0 && Math.abs(sum - creditedAmount) <= tolerance) {
      found = [...chosen];
      return;
    }
    if (chosen.length >= maxCombo || sum > creditedAmount + tolerance) return;
    for (let i = startIdx; i < n; i++) {
      chosen.push(candidates[i]);
      search(i + 1, chosen, round2(sum + candidates[i].remainingAmount));
      chosen.pop();
      if (found) return;
    }
  };

  search(0, [], 0);
  if (!found) return null;

  const total = round2((found as any[]).reduce((s, b) => s + b.remainingAmount, 0));
  return { bills: found, totalAmount: total, matchType: "combination" };
}

// ============================================================
// STEP 3 — DEDUCTION CLASSIFICATION
// ============================================================

/**
 * Institute's learned deduction history takes priority; falls back to null when
 * there isn't enough history yet so the caller uses the default percentage rule.
 */
export function suggestDeductionTypeFromHistory(
  seller: SellerForMatching | null | undefined,
  deductionPercent: number
): DeductionType | null {
  const profile = seller?.deductionProfile;
  if (!profile) return null;

  const { tdsOnlyCount = 0, tdsGstCount = 0, kasarCount = 0, kasarRange } = profile;

  if (
    kasarCount >= 2 &&
    kasarRange?.min !== null &&
    kasarRange?.min !== undefined &&
    deductionPercent >= kasarRange.min - 0.5 &&
    deductionPercent <= (kasarRange.max ?? kasarRange.min) + 0.5
  ) {
    return "Kasar";
  }

  if (tdsGstCount >= 3 && tdsGstCount > tdsOnlyCount) return "TDS+GST";
  if (tdsOnlyCount >= 3 && tdsOnlyCount >= tdsGstCount) return "TDS";

  return null;
}

export interface DeductionClassification {
  type: DeductionType | null;
  percent: number;
}

/** Step 3: classify a deduction as TDS (~2%), TDS+GST (~4%), or Kasar (anything else). */
export function classifyDeduction(
  billAmount: number,
  creditedAmount: number,
  seller?: SellerForMatching | null
): DeductionClassification {
  if (!billAmount) return { type: null, percent: 0 };
  const deduction = billAmount - creditedAmount;
  const percent = round2((deduction / billAmount) * 100);
  if (percent <= 0) return { type: null, percent: 0 };

  const historySuggestion = suggestDeductionTypeFromHistory(seller, percent);
  if (historySuggestion) return { type: historySuggestion, percent };

  if (percent >= 1.25 && percent <= 2.75) return { type: "TDS", percent };
  if (percent >= 3.25 && percent <= 4.75) return { type: "TDS+GST", percent };
  return { type: "Kasar", percent };
}
