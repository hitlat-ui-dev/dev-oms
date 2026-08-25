import type { Db } from "mongodb";

// Stock-history entries record the actor as free text, e.g. "READY TO SHIP by Chintan" —
// this is the only place in the current schema that attributes an action to a user.
const ACTIVITY_SUFFIX = /\sby\s(.+)$/i;

export interface TeamActivityRow {
  username: string;
  totalActions: number;
  actions: Record<string, number>;
  ordersCreated: number;
  ordersCreatedQty: number;
  filesUploaded: number;
  productsCompleted: number;
}

/** Merges every user-attributed signal the app writes over [start, end):
 * order status/purchase actions (items.history), new orders created
 * (sellerorders.createdBy), and GeM Sync file uploads / product completions
 * (gem_sheets). Shared by the "today" Summary dashboard and the Monthly/
 * Yearly Team Performance view so both stay consistent with each other. */
export async function computeTeamActivity(
  db: Db,
  opts: { start: Date; end: Date; firmCode?: string | null }
): Promise<TeamActivityRow[]> {
  const { start, end, firmCode } = opts;

  const activityByUser = new Map<string, TeamActivityRow>();
  const getBucket = (username: string): TeamActivityRow => {
    let bucket = activityByUser.get(username);
    if (!bucket) {
      bucket = { username, totalActions: 0, actions: {}, ordersCreated: 0, ordersCreatedQty: 0, filesUploaded: 0, productsCompleted: 0 };
      activityByUser.set(username, bucket);
    }
    return bucket;
  };

  // $elemMatch first so items with zero history entries in range are excluded
  // before any $unwind runs, then $filter trims each surviving item's array
  // down to just this range's entries before unwinding - unwinding every
  // history entry of every item (this app's audit-log field, unbounded for
  // long-lived SKUs) and filtering by date afterward would be far slower.
  const historyEntries = await db
    .collection("items")
    .aggregate([
      { $match: { history: { $elemMatch: { date: { $gte: start, $lt: end } } } } },
      {
        $project: {
          history: {
            $filter: {
              input: "$history",
              as: "h",
              cond: { $and: [{ $gte: ["$$h.date", start] }, { $lt: ["$$h.date", end] }] },
            },
          },
        },
      },
      { $unwind: "$history" },
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

  // New orders created in range, by whoever placed/verified them (createdBy)
  const orderCreationMatch: Record<string, any> = { createdAt: { $gte: start, $lt: end }, createdBy: { $exists: true, $ne: "" } };
  if (firmCode) orderCreationMatch.firmCode = firmCode;
  const ordersCreatedAgg = await db
    .collection("sellerorders")
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

  // GeM Sync: files uploaded in range + products marked completed in range
  const gemSheets = db.collection("gem_sheets");
  const startISO = start.toISOString();
  const endISO = end.toISOString();

  const uploadsAgg = await gemSheets
    .aggregate([
      { $match: { uploadedBy: { $exists: true, $ne: "" }, uploadedAt: { $gte: startISO, $lt: endISO } } },
      { $group: { _id: "$uploadedBy", filesUploaded: { $sum: 1 } } },
    ])
    .toArray();
  for (const row of uploadsAgg) {
    getBucket(row._id).filesUploaded += row.filesUploaded;
  }

  const completionsAgg = await gemSheets
    .aggregate([
      {
        $match: {
          uploadedRows: {
            $elemMatch: { completedBy: { $exists: true, $ne: "" }, completedAt: { $gte: startISO, $lt: endISO } },
          },
        },
      },
      {
        $project: {
          uploadedRows: {
            $filter: {
              input: "$uploadedRows",
              as: "r",
              cond: {
                $and: [
                  { $ne: ["$$r.completedBy", ""] },
                  { $gte: ["$$r.completedAt", startISO] },
                  { $lt: ["$$r.completedAt", endISO] },
                ],
              },
            },
          },
        },
      },
      { $unwind: "$uploadedRows" },
      { $group: { _id: "$uploadedRows.completedBy", productsCompleted: { $sum: 1 } } },
    ])
    .toArray();
  for (const row of completionsAgg) {
    getBucket(row._id).productsCompleted += row.productsCompleted;
  }

  return [...activityByUser.values()].sort(
    (a, b) =>
      b.totalActions + b.ordersCreated + b.filesUploaded + b.productsCompleted -
      (a.totalActions + a.ordersCreated + a.filesUploaded + a.productsCompleted)
  );
}

export interface TeamActivityBucketRow extends TeamActivityRow {
  bucket: string; // "YYYY-MM-DD" (day) or "YYYY-MM" (month), UTC
}

/** Same three signals as computeTeamActivity, but grouped by (day-or-month, username)
 * instead of just username - powers the per-member day-wise / month-wise trend chart.
 * gem_sheets timestamps are stored as ISO strings (not Date), so their bucket is taken
 * as a substring rather than $dateToString - the first 10/7 characters of an ISO 8601
 * string already are "YYYY-MM-DD"/"YYYY-MM". */
export async function computeTeamActivityByBucket(
  db: Db,
  opts: { start: Date; end: Date; firmCode?: string | null; bucketBy: "day" | "month" }
): Promise<TeamActivityBucketRow[]> {
  const { start, end, firmCode, bucketBy } = opts;
  const dateFormat = bucketBy === "day" ? "%Y-%m-%d" : "%Y-%m";
  const isoSubstrLen = bucketBy === "day" ? 10 : 7;

  const byKey = new Map<string, TeamActivityBucketRow>();
  const getBucket = (bucket: string, username: string): TeamActivityBucketRow => {
    const key = `${bucket}|${username}`;
    let row = byKey.get(key);
    if (!row) {
      row = { bucket, username, totalActions: 0, actions: {}, ordersCreated: 0, ordersCreatedQty: 0, filesUploaded: 0, productsCompleted: 0 };
      byKey.set(key, row);
    }
    return row;
  };

  const historyEntries = await db
    .collection("items")
    .aggregate([
      { $match: { history: { $elemMatch: { date: { $gte: start, $lt: end } } } } },
      {
        $project: {
          history: {
            $filter: {
              input: "$history",
              as: "h",
              cond: { $and: [{ $gte: ["$$h.date", start] }, { $lt: ["$$h.date", end] }] },
            },
          },
        },
      },
      { $unwind: "$history" },
      {
        $project: {
          _id: 0,
          type: "$history.type",
          byWhom: "$history.byWhom",
          bucket: { $dateToString: { format: dateFormat, date: "$history.date" } },
        },
      },
    ])
    .toArray();
  for (const entry of historyEntries) {
    const rawType: string = entry.type || "";
    const username = (entry.byWhom && String(entry.byWhom).trim()) || rawType.match(ACTIVITY_SUFFIX)?.[1]?.trim() || "Unknown";
    const actionLabel = rawType.replace(ACTIVITY_SUFFIX, "").trim() || "Activity";
    const row = getBucket(entry.bucket, username);
    row.totalActions += 1;
    row.actions[actionLabel] = (row.actions[actionLabel] || 0) + 1;
  }

  const orderCreationMatch: Record<string, any> = { createdAt: { $gte: start, $lt: end }, createdBy: { $exists: true, $ne: "" } };
  if (firmCode) orderCreationMatch.firmCode = firmCode;
  const ordersCreatedAgg = await db
    .collection("sellerorders")
    .aggregate([
      { $match: orderCreationMatch },
      { $project: { createdBy: 1, reQty: 1, bucket: { $dateToString: { format: dateFormat, date: "$createdAt" } } } },
      {
        $group: {
          _id: { bucket: "$bucket", user: "$createdBy" },
          ordersCreated: { $sum: 1 },
          ordersCreatedQty: { $sum: { $ifNull: ["$reQty", 0] } },
        },
      },
    ])
    .toArray();
  for (const r of ordersCreatedAgg) {
    const row = getBucket(r._id.bucket, r._id.user);
    row.ordersCreated += r.ordersCreated;
    row.ordersCreatedQty += r.ordersCreatedQty;
  }

  const gemSheets = db.collection("gem_sheets");
  const startISO = start.toISOString();
  const endISO = end.toISOString();

  const uploadsAgg = await gemSheets
    .aggregate([
      { $match: { uploadedBy: { $exists: true, $ne: "" }, uploadedAt: { $gte: startISO, $lt: endISO } } },
      { $project: { uploadedBy: 1, bucket: { $substrCP: ["$uploadedAt", 0, isoSubstrLen] } } },
      { $group: { _id: { bucket: "$bucket", user: "$uploadedBy" }, filesUploaded: { $sum: 1 } } },
    ])
    .toArray();
  for (const r of uploadsAgg) {
    const row = getBucket(r._id.bucket, r._id.user);
    row.filesUploaded += r.filesUploaded;
  }

  const completionsAgg = await gemSheets
    .aggregate([
      {
        $match: {
          uploadedRows: {
            $elemMatch: { completedBy: { $exists: true, $ne: "" }, completedAt: { $gte: startISO, $lt: endISO } },
          },
        },
      },
      {
        $project: {
          uploadedRows: {
            $filter: {
              input: "$uploadedRows",
              as: "r",
              cond: {
                $and: [
                  { $ne: ["$$r.completedBy", ""] },
                  { $gte: ["$$r.completedAt", startISO] },
                  { $lt: ["$$r.completedAt", endISO] },
                ],
              },
            },
          },
        },
      },
      { $unwind: "$uploadedRows" },
      {
        $project: {
          completedBy: "$uploadedRows.completedBy",
          bucket: { $substrCP: ["$uploadedRows.completedAt", 0, isoSubstrLen] },
        },
      },
      { $group: { _id: { bucket: "$bucket", user: "$completedBy" }, productsCompleted: { $sum: 1 } } },
    ])
    .toArray();
  for (const r of completionsAgg) {
    const row = getBucket(r._id.bucket, r._id.user);
    row.productsCompleted += r.productsCompleted;
  }

  return [...byKey.values()];
}
