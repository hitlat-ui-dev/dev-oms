import {
  findCombinationMatch,
  withRemainingAmounts,
  classifyDeduction,
  round2,
  SellerForMatching,
  DeductionType,
} from "./matchingEngine";

// ============================================================
// ADDITION 1 — INSTITUTE-WISE MULTI-ORDER CLUSTERING
// ============================================================

export interface ClusterableOrder {
  _id: any;
  orderNo: string;
  contractDate: string;
  totalAmount: number;
  paidAmount?: number;
  [key: string]: any;
}

export interface OrderCluster {
  orders: ClusterableOrder[];
  startDate: string;
  endDate: string;
}

// Gap-detection is adaptive (no fixed day-range, per the spec), but two constants
// keep it well-behaved at the edges:
//  - a gap smaller than this never splits a cluster, even if the institute's
//    typical gap so far is ~0 (e.g. several same-day orders in a row)
//  - once a cluster does have some gap history, the next gap must exceed that
//    running median by this multiplier to count as "significantly larger"
const MIN_GAP_DAYS_FLOOR = 5;
const GAP_SIGNIFICANCE_MULTIPLIER = 3;

function parseOrderDate(s?: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function toCluster(entries: { order: ClusterableOrder; date: Date }[]): OrderCluster {
  return {
    orders: entries.map((e) => e.order),
    startDate: entries[0].order.contractDate,
    endDate: entries[entries.length - 1].order.contractDate,
  };
}

/**
 * Groups one institute's orders into date-burst clusters using adaptive gap
 * detection: walk the orders chronologically, and close the current cluster
 * whenever the next gap is significantly larger than the median gap seen so
 * far *within that cluster* — there is deliberately no fixed day-range, since
 * real burst/gap/burst patterns vary per institute (see Addition 1 spec).
 * Orders with a missing/unparseable contractDate can't be placed in a burst,
 * so each becomes its own singleton cluster rather than being dropped.
 */
export function buildClusters(
  orders: ClusterableOrder[],
  opts: { minGapDaysFloor?: number; gapMultiplier?: number } = {}
): OrderCluster[] {
  const minGapDaysFloor = opts.minGapDaysFloor ?? MIN_GAP_DAYS_FLOOR;
  const gapMultiplier = opts.gapMultiplier ?? GAP_SIGNIFICANCE_MULTIPLIER;

  const dated: { order: ClusterableOrder; date: Date }[] = [];
  const undated: ClusterableOrder[] = [];
  for (const o of orders) {
    const d = parseOrderDate(o.contractDate);
    if (d) dated.push({ order: o, date: d });
    else undated.push(o);
  }
  dated.sort((a, b) => a.date.getTime() - b.date.getTime());

  const clusters: OrderCluster[] = [];
  let current: { order: ClusterableOrder; date: Date }[] = [];
  let gapsInCurrentRun: number[] = [];

  for (const entry of dated) {
    if (current.length === 0) {
      current.push(entry);
      continue;
    }
    const prevDate = current[current.length - 1].date;
    const gapDays = (entry.date.getTime() - prevDate.getTime()) / 86400000;
    const runningMedian = median(gapsInCurrentRun);
    const threshold = Math.max(minGapDaysFloor, runningMedian * gapMultiplier);

    if (gapDays > threshold) {
      clusters.push(toCluster(current));
      current = [entry];
      gapsInCurrentRun = [];
    } else {
      gapsInCurrentRun.push(gapDays);
      current.push(entry);
    }
  }
  if (current.length > 0) clusters.push(toCluster(current));

  for (const o of undated) clusters.push({ orders: [o], startDate: "", endDate: "" });

  return clusters;
}

// ============================================================
// ADDITION 1 — DEDUCTION-AWARE COMBINATION MATCHING
// ============================================================

export interface ClusterCombinationMatchResult {
  bills: any[];
  totalAmount: number;
  deductionAmount: number;
  deductionType: DeductionType | null;
  deductionUsedHistory: boolean;
  matchType: "combination" | "combination-deduction";
}

/**
 * Extends findCombinationMatch (exact-sum only) with a deduction pass: when no
 * subset of bills sums exactly to the credited amount, search for a subset whose
 * sum is somewhat larger (up to ~20%, mirroring findAmountMatch's single-bill
 * tolerance) and classify the shortfall ONCE against the combined total — a
 * deduction is never split/recomputed per individual order in the combo.
 */
export function findClusterCombinationMatch(
  bills: any[],
  creditedAmount: number,
  seller?: SellerForMatching | null,
  tolerance = 5,
  maxCombo = 4
): ClusterCombinationMatchResult | null {
  const exact = findCombinationMatch(bills, creditedAmount, tolerance, maxCombo);
  if (exact) {
    return {
      bills: exact.bills,
      totalAmount: exact.totalAmount,
      deductionAmount: 0,
      deductionType: null,
      deductionUsedHistory: false,
      matchType: "combination",
    };
  }

  const candidates = withRemainingAmounts(bills)
    .filter((b) => b.remainingAmount > 0)
    .slice(0, 25);
  const n = candidates.length;
  if (n < 2) return null;

  // Even a ~20% deduction can't come from a combined total bigger than this.
  const upperBound = creditedAmount / 0.8;
  let found: any[] | null = null;

  const search = (startIdx: number, chosen: any[], sum: number) => {
    if (found) return;
    if (chosen.length > 0 && sum > creditedAmount + tolerance && sum <= upperBound) {
      found = [...chosen];
      return;
    }
    if (chosen.length >= maxCombo || sum > upperBound) return;
    for (let i = startIdx; i < n; i++) {
      chosen.push(candidates[i]);
      search(i + 1, chosen, round2(sum + candidates[i].remainingAmount));
      chosen.pop();
      if (found) return;
    }
  };

  search(0, [], 0);
  if (!found) return null;

  const totalAmount = round2((found as any[]).reduce((s, b) => s + b.remainingAmount, 0));
  const classification = classifyDeduction(totalAmount, creditedAmount, seller);
  return {
    bills: found,
    totalAmount,
    deductionAmount: round2(totalAmount - creditedAmount),
    deductionType: classification.type,
    deductionUsedHistory: classification.usedHistory,
    matchType: "combination-deduction",
  };
}
