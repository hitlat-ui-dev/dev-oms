import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { computeTeamActivity } from "@/lib/teamActivity";

// Orders in these statuses are void — never counted toward order value, payments, or activity.
const RETURN_FAMILY = ["CANCELL ORDER", "RETURN ORDER", "RETURN RECEIVED"];
// Still "in the pipeline" — not yet billed/settled.
const PENDING_STATUSES = ["TO CHECK", "READY TO SHIP", "DELIVERY"];

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// GET: single-call aggregation powering the Summary dashboard — order value, today's
// activity, pending orders/payments, order-status pipeline, purchase intake, and a
// best-effort "who did what today" report mined from items.history.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const firmCode = searchParams.get("firmCode");

    const client = await clientPromise;
    const db = client.db();

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    const baseMatch: Record<string, any> = { status: { $nin: RETURN_FAMILY } };
    if (firmCode) baseMatch.firmCode = firmCode;

    const orders = db.collection("sellerorders");

    const [facetResult] = await orders
      .aggregate([
        { $match: baseMatch },
        {
          $facet: {
            totals: [
              {
                $group: {
                  _id: null,
                  totalOrderValue: { $sum: { $ifNull: ["$totalAmount", 0] } },
                  totalReceived: { $sum: { $ifNull: ["$paidAmount", 0] } },
                  totalDeducted: { $sum: { $ifNull: ["$deductionAmount", 0] } },
                  orderCount: { $sum: 1 },
                },
              },
            ],
            today: [
              { $match: { createdAt: { $gte: todayStart, $lt: todayEnd } } },
              {
                $group: {
                  _id: null,
                  todayOrderValue: { $sum: { $ifNull: ["$totalAmount", 0] } },
                  todayOrderQty: { $sum: { $ifNull: ["$reQty", 0] } },
                  todayOrderCount: { $sum: 1 },
                },
              },
            ],
            pending: [
              { $match: { status: { $in: PENDING_STATUSES } } },
              {
                $group: {
                  _id: null,
                  pendingOrderCount: { $sum: 1 },
                  pendingOrderValue: { $sum: { $ifNull: ["$totalAmount", 0] } },
                },
              },
            ],
            statusBreakdown: [
              {
                $group: {
                  _id: "$status",
                  count: { $sum: 1 },
                  value: { $sum: { $ifNull: ["$totalAmount", 0] } },
                },
              },
              { $sort: { value: -1 } },
            ],
          },
        },
      ])
      .toArray();

    const totals = facetResult.totals[0] || { totalOrderValue: 0, totalReceived: 0, totalDeducted: 0, orderCount: 0 };
    const today = facetResult.today[0] || { todayOrderValue: 0, todayOrderQty: 0, todayOrderCount: 0 };
    const pending = facetResult.pending[0] || { pendingOrderCount: 0, pendingOrderValue: 0 };
    const statusBreakdown = (facetResult.statusBreakdown || []).map((s: any) => ({
      status: s._id || "Unknown",
      count: s.count,
      value: round2(s.value),
    }));

    const pendingPaymentValue = Math.max(0, round2(totals.totalOrderValue - totals.totalReceived - totals.totalDeducted));

    // Today's purchase intake (complements the sales-side numbers above)
    const purchaseMatch: Record<string, any> = { receivedAt: { $gte: todayStart, $lt: todayEnd } };
    const [purchaseAgg] = await db
      .collection("Received purchase")
      .aggregate([
        { $match: purchaseMatch },
        {
          $group: {
            _id: null,
            todayPurchaseValue: { $sum: { $multiply: [{ $ifNull: ["$receivedQty", 0] }, { $ifNull: ["$rate", 0] }] } },
            todayPurchaseCount: { $sum: 1 },
          },
        },
      ])
      .toArray();
    const purchase = purchaseAgg || { todayPurchaseValue: 0, todayPurchaseCount: 0 };

    const openPurchaseRequests = await db.collection("purchase_requests").countDocuments({ status: "Purchase Request" });

    // Bills generated today, broken down by firm - counts the generation
    // event itself (createdAt), not whether the bill is still valid, so a
    // bill cancelled later the same day still counts here.
    const billsMatch: Record<string, any> = { createdAt: { $gte: todayStart, $lt: todayEnd } };
    if (firmCode) billsMatch.firmCode = firmCode;
    const billsTodayAgg = await db
      .collection("bills")
      .aggregate([
        { $match: billsMatch },
        {
          $group: {
            _id: { $ifNull: ["$firmCode", "Unknown"] },
            count: { $sum: 1 },
            value: { $sum: { $ifNull: ["$grandTotal", 0] } },
          },
        },
        { $sort: { count: -1 } },
      ])
      .toArray();
    const billsToday = {
      totalCount: billsTodayAgg.reduce((s: number, r: any) => s + r.count, 0),
      totalValue: round2(billsTodayAgg.reduce((s: number, r: any) => s + r.value, 0)),
      byFirm: billsTodayAgg.map((r: any) => ({ firmCode: r._id, count: r.count, value: round2(r.value) })),
    };

    // Dashboard stats strip: bids still sitting untriaged, and items at/under their
    // reorder threshold — both cheap counts, computed alongside everything else here
    // so the dashboard has one summary endpoint to call rather than several small ones.
    const bidsPendingAction = await db.collection("gem_bids").countDocuments({ currentSection: "fetched_bid_data" });
    const lowStockCount = await db
      .collection("stock")
      .countDocuments({ reQty: { $gt: 0 }, $expr: { $lte: ["$quantity", "$reQty"] } });

    // Team activity today — merged from every user-attributed signal the app writes:
    // order status/purchase actions (items.history), new orders created (sellerorders.createdBy),
    // and GeM Sync file uploads / product completions (gem_sheets). Shared with the
    // Monthly/Yearly Team Performance view (see /api/team-performance) so both stay consistent.
    const teamActivity = await computeTeamActivity(db, { start: todayStart, end: todayEnd, firmCode });

    return NextResponse.json({
      totals: {
        totalOrderValue: round2(totals.totalOrderValue),
        orderCount: totals.orderCount,
        totalReceived: round2(totals.totalReceived),
        totalDeducted: round2(totals.totalDeducted),
        pendingPaymentValue,
      },
      today: {
        todayOrderValue: round2(today.todayOrderValue),
        todayOrderQty: today.todayOrderQty,
        todayOrderCount: today.todayOrderCount,
      },
      pending: {
        pendingOrderCount: pending.pendingOrderCount,
        pendingOrderValue: round2(pending.pendingOrderValue),
      },
      statusBreakdown,
      purchase: {
        todayPurchaseValue: round2(purchase.todayPurchaseValue || 0),
        todayPurchaseCount: purchase.todayPurchaseCount || 0,
        openPurchaseRequests,
      },
      teamActivity,
      billsToday,
      bidsPendingAction,
      lowStockCount,
    });
  } catch (error: any) {
    console.error("Dashboard summary GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to build dashboard summary" }, { status: 500 });
  }
}
