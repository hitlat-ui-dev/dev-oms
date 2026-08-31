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
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

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
                  todayOrderCount: { $sum: 1 },
                },
              },
            ],
            thisMonth: [
              { $match: { createdAt: { $gte: monthStart } } },
              {
                $group: {
                  _id: null,
                  monthOrderValue: { $sum: { $ifNull: ["$totalAmount", 0] } },
                  monthOrderCount: { $sum: 1 },
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
    const today = facetResult.today[0] || { todayOrderValue: 0, todayOrderCount: 0 };
    const thisMonth = facetResult.thisMonth[0] || { monthOrderValue: 0, monthOrderCount: 0 };
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

    // Pending bills by firm: orders that still need a bill generated -
    // billId missing/null (matches both, same as /api/bills/eligible-orders),
    // not marked bill-exempt, and not cancelled. Grouped first by
    // firmCode+contractNo (one contract = one eventual bill, same grouping
    // eligible-orders uses; an order with no contractNo counts as its own
    // bill) then rolled up per firm to get a bill count, not a raw order-line count.
    const pendingBillsMatch: Record<string, any> = {
      billId: null,
      billExempt: { $ne: true },
      status: { $ne: "CANCELL ORDER" },
    };
    if (firmCode) pendingBillsMatch.firmCode = firmCode;
    const pendingBillsByFirmAgg = await orders
      .aggregate([
        { $match: pendingBillsMatch },
        {
          $group: {
            _id: {
              firmCode: { $ifNull: ["$firmCode", "Unknown"] },
              contractNo: { $ifNull: ["$contractNo", { $concat: ["_no_contract_", { $toString: "$_id" }] }] },
            },
            value: { $sum: { $ifNull: ["$totalAmount", 0] } },
          },
        },
        {
          $group: {
            _id: "$_id.firmCode",
            pendingBillCount: { $sum: 1 },
            pendingBillValue: { $sum: "$value" },
          },
        },
        { $sort: { pendingBillCount: -1 } },
      ])
      .toArray();
    const pendingBillsByFirm = pendingBillsByFirmAgg.map((r: any) => ({
      firmCode: r._id,
      count: r.pendingBillCount,
      value: round2(r.pendingBillValue),
    }));

    // Bills generated by team member (all-time, from bills.createdBy) - same
    // "counts the generation event" convention as billsToday above, so a
    // later-cancelled bill still counts toward who generated it.
    const billsByUserMatch: Record<string, any> = {};
    if (firmCode) billsByUserMatch.firmCode = firmCode;
    const billsByUserAgg = await db
      .collection("bills")
      .aggregate([
        { $match: billsByUserMatch },
        {
          $group: {
            _id: { $ifNull: ["$createdBy", "Unknown"] },
            count: { $sum: 1 },
            value: { $sum: { $ifNull: ["$grandTotal", 0] } },
          },
        },
        { $sort: { count: -1 } },
      ])
      .toArray();
    const billsByUser = billsByUserAgg.map((r: any) => ({
      username: r._id || "Unknown",
      count: r.count,
      value: round2(r.value),
    }));

    // Dashboard stats strip: bids still sitting untriaged, and items at/under their
    // reorder threshold — both cheap counts, computed alongside everything else here
    // so the dashboard has one summary endpoint to call rather than several small ones.
    const bidsPendingAction = await db.collection("gem_bids").countDocuments({ currentSection: "fetched_bid_data" });
    const lowStockCount = await db
      .collection("stock")
      .countDocuments({ reQty: { $gt: 0 }, $expr: { $lte: ["$quantity", "$reQty"] } });

    // GeM Sync report: how many Requirement Mapping Console rows were actioned
    // via each of the 3 buttons (all-time, from the append-only gem_action_log),
    // plus the current Sync Checklist snapshot (Pending vs Synced) for both of
    // its portions - Stock Update (gem_listings) and New Upload Link.
    const [okLinkCount, updateStockCount, newLinkActionCount, gemActionByUserAgg] = await Promise.all([
      db.collection("gem_action_log").countDocuments({ type: "ok_link" }),
      db.collection("gem_action_log").countDocuments({ type: "update_stock" }),
      db.collection("gem_action_log").countDocuments({ type: "new_link" }),
      db
        .collection("gem_action_log")
        .aggregate([
          { $group: { _id: { by: { $ifNull: ["$by", "Unknown"] }, type: "$type" }, count: { $sum: 1 } } },
        ])
        .toArray(),
    ]);
    // Per-user split of the same all-time action log, for "who did how much
    // GeM Sync work" - keyed by the `by` username each action was logged
    // under (see log_gem_action in app/api/gem-sync/route.ts).
    const gemByUserMap: Record<string, { okLink: number; updateStock: number; newLink: number }> = {};
    for (const row of gemActionByUserAgg as any[]) {
      const user = row._id.by || "Unknown";
      if (!gemByUserMap[user]) gemByUserMap[user] = { okLink: 0, updateStock: 0, newLink: 0 };
      if (row._id.type === "ok_link") gemByUserMap[user].okLink = row.count;
      else if (row._id.type === "update_stock") gemByUserMap[user].updateStock = row.count;
      else if (row._id.type === "new_link") gemByUserMap[user].newLink = row.count;
    }
    const gemSyncByUser = Object.entries(gemByUserMap)
      .map(([username, c]) => ({ username, ...c, total: c.okLink + c.updateStock + c.newLink }))
      .sort((a, b) => b.total - a.total);
    const [stockUpdatePending, stockUpdateSynced, newUploadLinkPending, newUploadLinkSynced] = await Promise.all([
      db.collection("gem_listings").countDocuments({ status: "Pending" }),
      db.collection("gem_listings").countDocuments({ status: "Synced" }),
      db.collection("gem_new_link_checklist").countDocuments({ status: "Pending" }),
      db.collection("gem_new_link_checklist").countDocuments({ status: "Synced" }),
    ]);
    const gemSync = {
      actions: { okLink: okLinkCount, updateStock: updateStockCount, newLink: newLinkActionCount },
      checklist: {
        stockUpdate: { pending: stockUpdatePending, synced: stockUpdateSynced },
        newUploadLink: { pending: newUploadLinkPending, synced: newUploadLinkSynced },
      },
      byUser: gemSyncByUser,
    };

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
        todayOrderCount: today.todayOrderCount,
      },
      thisMonth: {
        monthOrderValue: round2(thisMonth.monthOrderValue),
        monthOrderCount: thisMonth.monthOrderCount,
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
      pendingBillsByFirm,
      billsByUser,
      bidsPendingAction,
      lowStockCount,
      gemSync,
    });
  } catch (error: any) {
    console.error("Dashboard summary GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to build dashboard summary" }, { status: 500 });
  }
}
