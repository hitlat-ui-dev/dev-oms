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

export interface ClusterProfile {
  typicalGapDays: number | null;
  gapSamples: number[];
  lastUpdated?: Date | null;
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
  clusterProfile?: ClusterProfile;
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

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// A payment is never credited for MORE than the bill - only equal or short
// (short meaning a deduction was cut). This tiny buffer only absorbs float/
// paisa rounding noise, not a real overpayment allowance.
export const OVERPAY_ROUNDING_BUFFER = 1;

// TDS is always exactly 2% of the bill, cut alone; TDS+GST is always 2% TDS
// + 2% GST cut together (GST is never deducted on its own) - real confirmed
// data confirms this precisely (samples land within 1.98%-2.01%, not a loose
// "roughly 2%"). ±0.25% only absorbs paisa-level rounding, not real variance.
export const TDS_PERCENT = 2;
export const TDS_GST_PERCENT = 4;
export const DEDUCTION_PERCENT_TOLERANCE = 0.25;

// Real deduction history shows a payment is short-paid on only a small
// minority of bills, and even then never by more than TDS+GST's own ceiling
// - so the search window for "this might be a deduction" is capped just
// above that rather than the old blanket 20%, which routinely misclassified
// unrelated shortfalls as a deduction against the wrong bill.
export const MAX_DEDUCTION_FRACTION = (TDS_GST_PERCENT + DEDUCTION_PERCENT_TOLERANCE) / 100;

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

// Narration lines that are pure bank fees/charges — there is no institute/payer
// name to extract from these, so they should fall straight to "Unmatched".
const BANK_CHARGE_PATTERNS = [
  /\bDD\s*ISSUE\s*CHARGES?\b/,
  /\bCOMMN\s*DEBIT\b/,
  /\bCOMMISSION\b/,
  /\b(?:BANK\s*)?CHARGES?\b/,
  /\bSMS\s*CHARGES?\b/,
  /\bGST\s*ON\s*CHARGES?\b/,
  /\bMIN\s*BAL(?:ANCE)?\s*CHARGES?\b/,
  /\bPENAL(?:TY)?\s*CHARGES?\b/,
];

/**
 * Extracts the trailing payer-name fragment from a bank-statement narration:
 * the free text after a UTR code (e.g. "Cr.for UTR:RBISH00803362582 GOGJSPARSH S"
 * -> "GOGJSPARSH S"), or the last "/"-separated segment of a NEFT/RTGS/IMPS/UPI
 * reference (e.g. "NEFT/MSNUX26226205063/BLUE EXIM INNOVATI" -> "BLUE EXIM INNOVATI").
 * Returns null for bank-fee lines with no payer name to extract, or when neither
 * pattern applies (callers should fall back to extractKeywords()'s generic tokenizer).
 */
export function extractPayerKeyword(description?: string): string | null {
  if (!description) return null;
  const raw = description.trim();
  if (!raw) return null;
  if (BANK_CHARGE_PATTERNS.some((re) => re.test(normalizeText(raw)))) return null;

  const utrMatch = raw.match(/UTR:?\s*[A-Z0-9]{6,}\s+(.+)$/i);
  if (utrMatch && utrMatch[1].trim()) {
    const fragment = normalizeText(utrMatch[1]);
    if (fragment) return fragment;
  }

  if (/^(NEFT|RTGS|IMPS|UPI)\//i.test(raw)) {
    const segments = raw.split("/").map((s) => s.trim()).filter(Boolean);
    if (segments.length >= 2) {
      const fragment = normalizeText(segments[segments.length - 1]);
      if (fragment) return fragment;
    }
  }

  return null;
}

// ============================================================
// STEP 1 — INSTITUTE MATCH
// ============================================================

export interface InstituteCandidate extends InstituteMatchResult {
  // Length of the matched keyword text — used only to break ties between
  // candidates that score equally on amount/date fit (see scoreInstituteCandidates).
  matchLength: number;
}

/**
 * Collects every institute whose registered keyword matches the description —
 * a payer name like "Dist Treasury Mehsana" can legitimately belong to several
 * institutes' statementDescriptionName lists, so this deliberately does NOT pick
 * a single winner by keyword length alone (that used to silently hide ties).
 * One candidate per seller (its best-matching keyword), sorted longest-match-first.
 */
function collectInstituteCandidates(
  description: string,
  sellers: SellerForMatching[]
): InstituteCandidate[] {
  const desc = (description || "").toLowerCase();
  const bySeller = new Map<string, InstituteCandidate>();

  const consider = (seller: SellerForMatching, raw: string, candidateLower: string, matchLength: number) => {
    const key = String(seller._id ?? seller.instituteName);
    const existing = bySeller.get(key);
    if (existing && existing.matchLength >= matchLength) return;

    const meta = (seller.aliasMeta || []).find(
      (a) => (a.keyword || "").trim().toLowerCase() === candidateLower
    );
    const confidence = meta ? meta.confidence : 1;
    bySeller.set(key, {
      instituteName: seller.instituteName,
      sellerId: seller._id,
      matchedKeyword: raw,
      confidence,
      confidenceLabel: confidence >= 3 ? "high" : meta ? "low" : "new",
      matchLength,
    });
  };

  if (desc) {
    for (const seller of sellers) {
      const negatives = new Set(
        (seller.negativeKeywords || []).map((n) => (n.keyword || "").trim().toLowerCase())
      );
      for (const raw of seller.statementDescriptionName || []) {
        const candidate = (raw || "").trim().toLowerCase();
        if (candidate.length < 3) continue;
        if (negatives.has(candidate)) continue;
        if (!desc.includes(candidate)) continue;
        consider(seller, raw, candidate, candidate.length);
      }
    }
  }

  // Second pass: nothing in the full description contained a registered keyword
  // outright — likely a truncated bank narration (e.g. "DISTRICT TRE"). Fall back
  // to the UTR/NEFT-extracted payer fragment and match it bidirectionally, since
  // either the narration or the registered keyword could be the shorter/truncated one.
  if (bySeller.size === 0) {
    const fragment = extractPayerKeyword(description);
    if (fragment) {
      const fragmentLower = fragment.toLowerCase();
      for (const seller of sellers) {
        const negatives = new Set(
          (seller.negativeKeywords || []).map((n) => (n.keyword || "").trim().toLowerCase())
        );
        for (const raw of seller.statementDescriptionName || []) {
          const candidate = (raw || "").trim().toLowerCase();
          if (candidate.length < 3) continue;
          if (negatives.has(candidate)) continue;
          const isPrefixMatch =
            candidate.startsWith(fragmentLower) || fragmentLower.startsWith(candidate);
          if (!isPrefixMatch) continue;
          consider(seller, raw, candidate, candidate.length);
        }
      }
    }
  }

  return [...bySeller.values()].sort((a, b) => b.matchLength - a.matchLength);
}

/**
 * Richer sibling of lib/institutMatcher.ts's matchInstituteFromDescription: also honors
 * per-institute negativeKeywords (past rejections) and returns confidence info instead
 * of just the institute name, so the caller can persist a scored suggestion.
 * Returns only the single best candidate — use findInstituteMatches when a keyword
 * might legitimately belong to more than one institute and the caller wants to
 * disambiguate rather than silently pick one.
 */
export function findInstituteMatch(
  description: string,
  sellers: SellerForMatching[]
): InstituteMatchResult | null {
  return collectInstituteCandidates(description, sellers)[0] ?? null;
}

/** All institutes whose registered keyword matches the description, best match first. */
export function findInstituteMatches(
  description: string,
  sellers: SellerForMatching[]
): InstituteCandidate[] {
  return collectInstituteCandidates(description, sellers);
}

export interface ScoredInstituteCandidate extends InstituteCandidate {
  amountFit: boolean;
  dateFit: boolean;
  score: number;
  // Concrete evidence for amountFit - which bill(s) actually add up to the
  // credited amount for this candidate, shown to the user instead of just a
  // "fits/unclear" label so they can see WHY before picking between institutes
  // sharing the same keyword.
  matchedBillNos?: string[];
}

// How close (in days) a payment date needs to be to one of the institute's open
// bill dates to count as a "date fit" — a rough proxy until Phase 3's cluster
// engine gives a real per-institute burst window.
const DATE_FIT_WINDOW_DAYS = 60;

// A candidate is a "clear winner" over the runner-up once its score is ahead by
// more than this margin — below it, the two are close enough to ask the user.
export const AMBIGUITY_SCORE_MARGIN = 60;

/**
 * Scores each candidate institute by (a) whether the credited amount fits one of
 * its open bills/combinations and (b) whether the payment date falls near its
 * open-bill activity — used to resolve a keyword shared by multiple institutes
 * (Addition 2) without guessing. Amount fit is the dominant signal since two
 * institutes rarely have the same institute-specific pending amount at once.
 */
export async function scoreInstituteCandidates(
  db: Db,
  candidates: InstituteCandidate[],
  { creditedAmount, transactionDate, firmCode }: { creditedAmount: number; transactionDate?: string; firmCode?: string }
): Promise<ScoredInstituteCandidate[]> {
  const txnDate = transactionDate ? new Date(transactionDate) : null;
  const txnDateValid = !!txnDate && !isNaN(txnDate.getTime());

  const scored = await Promise.all(
    candidates.map(async (c) => {
      const openBills = await findOpenBills(db, { instituteName: c.instituteName, firmCode });
      const singleMatch = findAmountMatch(openBills, creditedAmount);
      const comboMatch = singleMatch ? null : findCombinationMatch(openBills, creditedAmount);
      const amountFit = !!(singleMatch || comboMatch);
      const matchedBillNos = singleMatch
        ? [singleMatch.bill.orderNo]
        : comboMatch
        ? comboMatch.bills.map((b) => b.orderNo)
        : undefined;

      let dateFit = false;
      if (txnDateValid) {
        for (const b of openBills) {
          if (!b.contractDate) continue;
          const billDate = new Date(b.contractDate);
          if (isNaN(billDate.getTime())) continue;
          if (Math.abs(txnDate!.getTime() - billDate.getTime()) / 86400000 <= DATE_FIT_WINDOW_DAYS) {
            dateFit = true;
            break;
          }
        }
      }

      const score = (amountFit ? 100 : 0) + (dateFit ? 20 : 0) + Math.min(c.matchLength, 15);
      return { ...c, amountFit, dateFit, score, matchedBillNos };
    })
  );

  return scored.sort((a, b) => b.score - a.score);
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

export const withRemainingAmounts = (bills: any[]) =>
  bills.map((b) => ({
    ...b,
    remainingAmount: round2(Number(b.totalAmount || 0) - Number(b.paidAmount || 0)),
  }));

/**
 * Step 2: match a credited amount to a single open bill, within tolerance for a full
 * settlement (never more than the bill, only equal or short), or — if the credited
 * amount is short by up to MAX_DEDUCTION_FRACTION — the closest bill by deduction
 * size, so Step 3 can classify what was deducted.
 */
export function findAmountMatch(
  bills: any[],
  creditedAmount: number,
  tolerance = 5
): BillMatchResult | null {
  const candidates = withRemainingAmounts(bills);

  // Credited can be up to `tolerance` short and still count as fully settled
  // (rounding-level), but never more than the bill by more than a paisa-level buffer.
  const exact = candidates.find(
    (b) => creditedAmount <= b.remainingAmount + OVERPAY_ROUNDING_BUFFER && creditedAmount >= b.remainingAmount - tolerance
  );
  if (exact) {
    return { bill: exact, remainingAmount: exact.remainingAmount, deductionAmount: 0, matchType: "exact" };
  }

  const shortPaid = candidates
    .filter(
      (b) =>
        creditedAmount < b.remainingAmount - tolerance &&
        creditedAmount >= b.remainingAmount * (1 - MAX_DEDUCTION_FRACTION)
    )
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
  const candidates = withRemainingAmounts(bills)
    .filter((b) => b.remainingAmount > 0)
    .slice(0, 25); // bound the search space

  const n = candidates.length;
  if (n < 2) return null;

  let found: any[] | null = null;

  const search = (startIdx: number, chosen: any[], sum: number) => {
    if (found) return;
    // Same never-more-than-the-bill rule as the single-bill matcher: the
    // combined bill total (sum) can be up to `tolerance` more than what was
    // credited (short-paid, rounding-level), but credited can only exceed
    // the total by the tiny paisa-rounding buffer, not the full tolerance.
    if (chosen.length > 0 && sum >= creditedAmount - OVERPAY_ROUNDING_BUFFER && sum <= creditedAmount + tolerance) {
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
    deductionPercent <= (kasarRange.max ?? kasarRange.min) + 0.5 &&
    // Even an institute's own learned history can't push Kasar outside the
    // hard 0.1%-3% business rule - a stray bad historical entry shouldn't be
    // able to teach the system to suggest an implausible deduction.
    deductionPercent >= 0.1 &&
    deductionPercent <= 3
  ) {
    return "Kasar";
  }

  // Same guard as Kasar above: history only overrides when the current
  // deduction is actually near TDS's fixed 2% (or TDS+GST's fixed 4%) - an
  // institute having 3+ past TDS deductions doesn't mean every future
  // deduction is TDS regardless of its size.
  if (
    tdsGstCount >= 3 &&
    tdsGstCount > tdsOnlyCount &&
    deductionPercent >= TDS_GST_PERCENT - DEDUCTION_PERCENT_TOLERANCE &&
    deductionPercent <= TDS_GST_PERCENT + DEDUCTION_PERCENT_TOLERANCE
  )
    return "TDS+GST";
  if (
    tdsOnlyCount >= 3 &&
    tdsOnlyCount >= tdsGstCount &&
    deductionPercent >= TDS_PERCENT - DEDUCTION_PERCENT_TOLERANCE &&
    deductionPercent <= TDS_PERCENT + DEDUCTION_PERCENT_TOLERANCE
  )
    return "TDS";

  return null;
}

export interface DeductionClassification {
  type: DeductionType | null;
  percent: number;
  // True when `type` came from the institute's own learned deductionProfile
  // rather than the generic percentage-range fallback — used to decide
  // whether a suggestion is confident enough to fast-track (see Phase 4).
  usedHistory: boolean;
}

/**
 * Step 3: classify a deduction as TDS (~2%), TDS+GST (~4%), or Kasar (0.1%-3%,
 * outside the TDS/TDS+GST bands). Real Kasar deductions never run wider than
 * 3% of the bill - anything larger (or a sub-0.1% sliver too small to be a
 * real deduction) isn't a plausible deduction at all and is left unclassified
 * (null) rather than guessed, so it surfaces for manual review instead of a
 * bad auto-suggestion.
 */
export function classifyDeduction(
  billAmount: number,
  creditedAmount: number,
  seller?: SellerForMatching | null
): DeductionClassification {
  if (!billAmount) return { type: null, percent: 0, usedHistory: false };
  const deduction = billAmount - creditedAmount;
  const percent = round2((deduction / billAmount) * 100);
  if (percent <= 0) return { type: null, percent: 0, usedHistory: false };

  const historySuggestion = suggestDeductionTypeFromHistory(seller, percent);
  if (historySuggestion) return { type: historySuggestion, percent, usedHistory: true };

  if (percent >= TDS_PERCENT - DEDUCTION_PERCENT_TOLERANCE && percent <= TDS_PERCENT + DEDUCTION_PERCENT_TOLERANCE) {
    return { type: "TDS", percent, usedHistory: false };
  }
  if (percent >= TDS_GST_PERCENT - DEDUCTION_PERCENT_TOLERANCE && percent <= TDS_GST_PERCENT + DEDUCTION_PERCENT_TOLERANCE) {
    return { type: "TDS+GST", percent, usedHistory: false };
  }
  if (percent >= 0.1 && percent <= 3) return { type: "Kasar", percent, usedHistory: false };
  return { type: null, percent, usedHistory: false };
}

// ============================================================
// STEP 4 — HIGH-CONFIDENCE FAST-TRACK (Addition 3, non-automatic)
// ============================================================

/**
 * A suggestion is "high confidence" only when the keyword match itself is
 * already trusted (learned aliasMeta confidence >= 3) AND the amount either
 * settled exactly or its deduction matched the institute's own learned
 * deduction history (not just the generic % fallback). This never skips the
 * Confirm click — it only decides whether the UI pre-fills/fast-tracks a row.
 */
export function isHighConfidenceMatch(params: {
  confidenceLabel: ConfidenceLabel;
  matchType: "exact" | "deduction" | "combination" | "combination-deduction" | null;
  deductionUsedHistory: boolean;
}): boolean {
  const { confidenceLabel, matchType, deductionUsedHistory } = params;
  if (confidenceLabel !== "high" || !matchType) return false;
  if (matchType === "exact" || matchType === "combination") return true;
  return deductionUsedHistory;
}
