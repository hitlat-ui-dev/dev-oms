// @/lib/paymentTurnaround.ts
// Read/compute layer over existing Billing (bills), Orders (sellerorders) and
// Reconciliation (bank_reconciliation_matches) data - no new schema.
//
// IMPORTANT (found by checking real data before writing this join): a formal
// Bill/tax-invoice (models/Bill.ts) and payment reconciliation are two
// disjoint concepts in this app - reconciliation confirms payment directly
// against a SellerOrder (bank_reconciliation_matches.billIds actually holds
// sellerorders _ids, see app/api/reconciliation/matches/[id]/route.ts) with
// no requirement that a formal Bill was ever generated for that order. In
// this dataset, 0 of the 135 "Paid" orders have a linked formal Bill at all.
// So the primary unit here is the SellerOrder itself (what accounts actually
// tracks payment against), not the Bill document - a formal Bill, when one
// exists for the order, is used only to supply a real invoice number/date.
import { Db, ObjectId } from "mongodb";

export const GEM_PAYMENT_BENCHMARK_DAYS = 45;

const RETURN_FAMILY = ["CANCELL ORDER", "RETURN ORDER", "RETURN RECEIVED"];

export interface TurnaroundRow {
  orderId: string;
  billNumber: string; // linked formal Bill's invoiceNumber, else the order's own orderNo
  billSource: "bill" | "order"; // which of the above billNumber came from
  firmCode: string;
  instituteName: string;
  billDate: string; // ISO - linked Bill's invoiceDate if generated, else order's contractDate/createdAt
  deliveryDate: string | null;
  paymentDate: string | null;
  daysBillToPayment: number | null;
  daysDeliveryToPayment: number | null;
  amount: number;
  status: "Paid" | "Pending";
}

export interface TurnaroundFilters {
  firmCode?: string;
  instituteName?: string;
  from?: string;
  to?: string;
  status?: "Paid" | "Pending" | "All";
}

const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000);

// SellerOrder.contractDate is stored as "DD/MM/YYYY".
function parseContractDate(s?: string): Date | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

export async function computeTurnaroundRows(db: Db, filters: TurnaroundFilters): Promise<TurnaroundRow[]> {
  const orderMatch: Record<string, any> = { status: { $nin: RETURN_FAMILY } };
  if (filters.firmCode) orderMatch.firmCode = filters.firmCode;
  if (filters.instituteName) orderMatch.instituteName = filters.instituteName;
  if (filters.from || filters.to) {
    orderMatch.createdAt = {};
    if (filters.from) orderMatch.createdAt.$gte = new Date(`${filters.from}T00:00:00`);
    if (filters.to) orderMatch.createdAt.$lte = new Date(`${filters.to}T23:59:59`);
  }

  const orders = await db
    .collection("sellerorders")
    .find(orderMatch)
    .project({
      orderNo: 1, firmCode: 1, instituteName: 1, contractDate: 1, deliveryDate: 1,
      totalAmount: 1, paymentStatus: 1, billId: 1, createdAt: 1,
    })
    .toArray();
  if (orders.length === 0) return [];

  const billIds = [...new Set(orders.map((o: any) => o.billId).filter(Boolean).map((id: any) => String(id)))];
  const bills = billIds.length
    ? await db
        .collection("bills")
        .find({ _id: { $in: billIds.map((id) => new ObjectId(id)) } })
        .project({ invoiceNumber: 1, invoiceDate: 1 })
        .toArray()
    : [];
  const billById = new Map(bills.map((b: any) => [String(b._id), b]));

  const orderIds = orders.map((o: any) => String(o._id));
  const matches = await db
    .collection("bank_reconciliation_matches")
    .find({ status: "confirmed", billIds: { $in: orderIds } })
    .project({ billIds: 1, transactionDate: 1 })
    .toArray();
  const paymentDateByOrder = new Map<string, string>();
  for (const m of matches) {
    for (const oid of m.billIds || []) {
      const key = String(oid);
      const existing = paymentDateByOrder.get(key);
      if (!existing || m.transactionDate > existing) paymentDateByOrder.set(key, m.transactionDate);
    }
  }

  const rows: TurnaroundRow[] = [];
  for (const o of orders as any[]) {
    const linkedBill = o.billId ? billById.get(String(o.billId)) : null;
    const billDateObj: Date = linkedBill
      ? new Date(linkedBill.invoiceDate)
      : parseContractDate(o.contractDate) || new Date(o.createdAt);
    const billDate = billDateObj.toISOString();
    const billNumber = linkedBill ? linkedBill.invoiceNumber : o.orderNo || "";
    const billSource: "bill" | "order" = linkedBill ? "bill" : "order";

    const deliveryDate: string | null = o.deliveryDate || null;
    const paymentDate = paymentDateByOrder.get(String(o._id)) || null;
    const status: "Paid" | "Pending" = o.paymentStatus === "Paid" ? "Paid" : "Pending";

    if (filters.status && filters.status !== "All" && filters.status !== status) continue;

    rows.push({
      orderId: String(o._id),
      billNumber,
      billSource,
      firmCode: o.firmCode,
      instituteName: o.instituteName,
      billDate,
      deliveryDate,
      paymentDate,
      daysBillToPayment: paymentDate ? daysBetween(billDateObj, new Date(paymentDate)) : null,
      daysDeliveryToPayment: paymentDate && deliveryDate ? daysBetween(new Date(deliveryDate), new Date(paymentDate)) : null,
      amount: o.totalAmount || 0,
      status,
    });
  }
  return rows;
}

// ============================================================
// Institute-wise summary + Payment Reliability Score
// ============================================================

export type ReliabilityBand = "Excellent" | "Good" | "Average" | "Poor";

export interface InstituteSummary {
  instituteName: string;
  totalBills: number;
  paidBills: number;
  pendingBills: number;
  totalPaidAmount: number;
  totalPendingAmount: number;
  avgDaysBillToPayment: number | null;
  avgDaysDeliveryToPayment: number | null;
  minDays: number | null;
  maxDays: number | null;
  speedScore: number;
  consistencyScore: number;
  pendingRatioScore: number;
  reliabilityScore: number;
  reliabilityBand: ReliabilityBand;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const bandFor = (score: number): ReliabilityBand => (score >= 80 ? "Excellent" : score >= 60 ? "Good" : score >= 40 ? "Average" : "Poor");

export function computeInstituteSummary(rows: TurnaroundRow[]): InstituteSummary[] {
  const byInstitute = new Map<string, TurnaroundRow[]>();
  for (const r of rows) {
    if (!byInstitute.has(r.instituteName)) byInstitute.set(r.instituteName, []);
    byInstitute.get(r.instituteName)!.push(r);
  }

  const summaries: InstituteSummary[] = [];
  for (const [instituteName, group] of byInstitute) {
    // The full Paid set drives the business counts/amounts; a narrower subset
    // (Paid AND has a usable deliveryDate) drives the day-based averages, since
    // some historical orders never got a deliveryDate recorded.
    const allPaid = group.filter((r) => r.status === "Paid");
    const paidWithDeliveryDays = allPaid.filter((r) => r.daysDeliveryToPayment !== null);
    const pending = group.filter((r) => r.status === "Pending");
    const days = paidWithDeliveryDays.map((r) => r.daysDeliveryToPayment as number);

    const avgDaysDeliveryToPayment = days.length ? round1(days.reduce((s, d) => s + d, 0) / days.length) : null;
    const paidWithBillDays = allPaid.filter((r) => r.daysBillToPayment !== null);
    const avgDaysBillToPayment = paidWithBillDays.length
      ? round1(paidWithBillDays.reduce((s, r) => s + (r.daysBillToPayment || 0), 0) / paidWithBillDays.length)
      : null;
    const minDays = days.length ? Math.min(...days) : null;
    const maxDays = days.length ? Math.max(...days) : null;

    const totalPaidAmount = allPaid.reduce((s, r) => s + r.amount, 0);
    const totalPendingAmount = pending.reduce((s, r) => s + r.amount, 0);

    // Speed: 0 days = 100, 2x the GeM benchmark (90 days) or worse = 0.
    const speedScore =
      avgDaysDeliveryToPayment === null ? 0 : clamp(100 - (avgDaysDeliveryToPayment / (GEM_PAYMENT_BENCHMARK_DAYS * 2)) * 100, 0, 100);

    // Consistency: standard deviation of days-to-payment, normalized against
    // the same benchmark. A single data point can't show inconsistency, so
    // it isn't penalized.
    let consistencyScore = 100;
    if (days.length >= 2) {
      const mean = avgDaysDeliveryToPayment as number;
      const variance = days.reduce((s, d) => s + (d - mean) ** 2, 0) / days.length;
      const stdDev = Math.sqrt(variance);
      consistencyScore = clamp(100 - (stdDev / GEM_PAYMENT_BENCHMARK_DAYS) * 100, 0, 100);
    } else if (days.length === 0) {
      consistencyScore = 0; // no paid history at all — nothing to be confident about
    }

    const totalForRatio = totalPaidAmount + totalPendingAmount;
    const pendingRatio = totalForRatio > 0 ? totalPendingAmount / totalForRatio : 0;
    const pendingRatioScore = clamp(100 - pendingRatio * 100, 0, 100);

    const reliabilityScore = Math.round(speedScore * 0.4 + consistencyScore * 0.3 + pendingRatioScore * 0.3);

    summaries.push({
      instituteName,
      totalBills: group.length,
      paidBills: allPaid.length,
      pendingBills: pending.length,
      totalPaidAmount: Math.round(totalPaidAmount * 100) / 100,
      totalPendingAmount: Math.round(totalPendingAmount * 100) / 100,
      avgDaysBillToPayment,
      avgDaysDeliveryToPayment,
      minDays,
      maxDays,
      speedScore: Math.round(speedScore),
      consistencyScore: Math.round(consistencyScore),
      pendingRatioScore: Math.round(pendingRatioScore),
      reliabilityScore,
      reliabilityBand: bandFor(reliabilityScore),
    });
  }

  // Fastest-paying first; institutes with no paid history yet sort last.
  return summaries.sort((a, b) => {
    if (a.avgDaysDeliveryToPayment === null && b.avgDaysDeliveryToPayment === null) return 0;
    if (a.avgDaysDeliveryToPayment === null) return 1;
    if (b.avgDaysDeliveryToPayment === null) return -1;
    return a.avgDaysDeliveryToPayment - b.avgDaysDeliveryToPayment;
  });
}

// ============================================================
// Ageing buckets for pending (unpaid) bills
// ============================================================

export interface AgeingBucket {
  bucket: "0-30" | "31-60" | "61-90" | "90+";
  count: number;
  amount: number;
  byInstitute: { instituteName: string; count: number; amount: number }[];
}

export function computeAgeing(rows: TurnaroundRow[], ageFrom: "deliveryDate" | "billDate" = "deliveryDate") {
  const now = new Date();
  const buckets: Record<string, TurnaroundRow[]> = { "0-30": [], "31-60": [], "61-90": [], "90+": [] };

  for (const r of rows) {
    if (r.status !== "Pending") continue;
    const anchor = ageFrom === "deliveryDate" ? r.deliveryDate || r.billDate : r.billDate;
    if (!anchor) continue;
    const ageDays = daysBetween(new Date(anchor), now);
    const bucket = ageDays <= 30 ? "0-30" : ageDays <= 60 ? "31-60" : ageDays <= 90 ? "61-90" : "90+";
    buckets[bucket].push(r);
  }

  const result: AgeingBucket[] = (Object.keys(buckets) as AgeingBucket["bucket"][]).map((bucket) => {
    const group = buckets[bucket];
    const byInstituteMap = new Map<string, { count: number; amount: number }>();
    for (const r of group) {
      const e = byInstituteMap.get(r.instituteName) || { count: 0, amount: 0 };
      e.count += 1;
      e.amount += r.amount;
      byInstituteMap.set(r.instituteName, e);
    }
    return {
      bucket,
      count: group.length,
      amount: Math.round(group.reduce((s, r) => s + r.amount, 0) * 100) / 100,
      byInstitute: Array.from(byInstituteMap.entries())
        .map(([instituteName, e]) => ({ instituteName, count: e.count, amount: Math.round(e.amount * 100) / 100 }))
        .sort((a, b) => b.amount - a.amount),
    };
  });

  return { ageFrom, buckets: result };
}
