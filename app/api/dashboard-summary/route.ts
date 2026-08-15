import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

// Orders in these statuses are void — never counted toward order value, payments, or activity.
const RETURN_FAMILY = ["CANCELL ORDER", "RETURN ORDER", "RETURN RECEIVED"];
// Still "in the pipeline" — not yet billed/settled.
const PENDING_STATUSES = ["TO CHECK", "READY TO SHIP", "DELIVERY"];

// Stock-history entries record the actor as free text, e.g. "READY TO SHIP by Chintan" —
// this is the only place in the current schema that attributes an action to a user.
const ACTIVITY_SUFFIX = /\sby\s(.+)$/i;

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

    // Dashboard stats strip: bids still sitting untriaged, and items at/under their
    // reorder threshold — both cheap counts, computed alongside everything else here
    // so the dashboard has one summary endpoint to call rather than several small ones.
    const bidsPendingAction = await db.collection("gem_bids").countDocuments({ currentSection: "fetched_bid_data" });
    const lowStockCount = await db
      .collection("stock")
      .countDocuments({ reQty: { $gt: 0 }, $expr: { $lte: ["$quantity", "$reQty"] } });

    // Team activity today — merged from every user-attributed signal the app writes:
    // order status/purchase actions (items.history), new orders created (sellerorders.createdBy),
    // and GeM Sync file uploads / product completions (gem_sheets).
    type ActivityBucket = {
      username: string;
      totalActions: number;
      actions: Record<string, number>;
      ordersCreated: number;
      ordersCreatedQty: number;
      filesUploaded: number;
      productsCompleted: number;
    };
    const activityByUser = new Map<string, ActivityBucket>();
    const getBucket = (username: string): ActivityBucket => {
      let bucket = activityByUser.get(username);
      if (!bucket) {
        bucket = { username, totalActions: 0, actions: {}, ordersCreated: 0, ordersCreatedQty: 0, filesUploaded: 0, productsCompleted: 0 };
        activityByUser.set(username, bucket);
      }
      return bucket;
    };

    const historyEntries = await db
      .collection("items")
      .aggregate([
        { $unwind: "$history" },
        { $match: { "history.date": { $gte: todayStart, $lt: todayEnd } } },
        { $project: { _id: 0, type: "$history.type", byWhom: "$history.byWhom", qty: "$history.qty" } },
      ])
      .toArray();
    for (const entry of historyEntries) {
      const rawType: string = entry.type || "";
      const username = (entry.byWhom && String(entry.byWhom).trim()) || rawType.match(ACTIVITY_SUFFIX)?.[1]?.trim() || "Unknown";
      const actionLabel = rawType.replace(ACTIVITY_SUFFIX, "").trim() || "Activity";

      const bucket = getBucket(username);
      bucket.totalActions += 1;
      bucket.actions[actionLabel] = (bucket.actions[actionLabel] || 0) + 1;
    }

    // New orders created today, by whoever placed/verified them (createdBy)
    const orderCreationMatch: Record<string, any> = { createdAt: { $gte: todayStart, $lt: todayEnd }, createdBy: { $exists: true, $ne: "" } };
    if (firmCode) orderCreationMatch.firmCode = firmCode;
    const ordersCreatedAgg = await orders
      .aggregate([
        { $match: orderCreationMatch },
        { $group: { _id: "$createdBy", ordersCreated: { $sum: 1 }, ordersCreatedQty: { $sum: { $ifNull: ["$reQty", 0] } } } },
      ])
      .toArray();
    for (const row of ordersCreatedAgg) {
      const bucket = getBucket(row._id);
      bucket.ordersCreated += row.ordersCreated;
      bucket.ordersCreatedQty += row.ordersCreatedQty;
    }

    // GeM Sync: files uploaded today + products marked completed today
    const gemSheets = db.collection("gem_sheets");
    const todayStartISO = todayStart.toISOString();
    const todayEndISO = todayEnd.toISOString();

    const uploadsAgg = await gemSheets
      .aggregate([
        { $match: { uploadedBy: { $exists: true, $ne: "" }, uploadedAt: { $gte: todayStartISO, $lt: todayEndISO } } },
        { $group: { _id: "$uploadedBy", filesUploaded: { $sum: 1 } } },
      ])
      .toArray();
    for (const row of uploadsAgg) {
      getBucket(row._id).filesUploaded += row.filesUploaded;
    }

    const completionsAgg = await gemSheets
      .aggregate([
        { $unwind: "$uploadedRows" },
        {
          $match: {
            "uploadedRows.completedBy": { $exists: true, $ne: "" },
            "uploadedRows.completedAt": { $gte: todayStartISO, $lt: todayEndISO },
          },
        },
        { $group: { _id: "$uploadedRows.completedBy", productsCompleted: { $sum: 1 } } },
      ])
      .toArray();
    for (const row of completionsAgg) {
      getBucket(row._id).productsCompleted += row.productsCompleted;
    }

    const teamActivity = [...activityByUser.values()].sort(
      (a, b) =>
        b.totalActions + b.ordersCreated + b.filesUploaded + b.productsCompleted -
        (a.totalActions + a.ordersCreated + a.filesUploaded + a.productsCompleted)
    );

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
      bidsPendingAction,
      lowStockCount,
    });
  } catch (error: any) {
    console.error("Dashboard summary GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to build dashboard summary" }, { status: 500 });
  }
}
