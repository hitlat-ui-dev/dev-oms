import { ObjectId } from "mongodb";

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** How much of an advance order's own qty hasn't been linked out to a GeM order yet. */
export async function getRemainingOut(db: any, orderId: string, orderReQty: number): Promise<number> {
  const agg = await db
    .collection("advance_order_links")
    .aggregate([{ $match: { advanceOrderId: orderId } }, { $group: { _id: null, total: { $sum: "$linkedQty" } } }])
    .toArray();
  return round2(Number(orderReQty || 0) - (agg[0]?.total || 0));
}

/** How much of a GeM order's own qty hasn't been covered by an advance order yet. */
export async function getRemainingIn(db: any, orderId: string, orderReQty: number): Promise<number> {
  const agg = await db
    .collection("advance_order_links")
    .aggregate([{ $match: { gemOrderId: orderId } }, { $group: { _id: null, total: { $sum: "$linkedQty" } } }])
    .toArray();
  return round2(Number(orderReQty || 0) - (agg[0]?.total || 0));
}

export interface LinkResult {
  ok: boolean;
  status: number;
  error?: string;
  doc?: any;
}

/**
 * The single source of truth for "can advanceOrder cover gemOrder for linkedQty units,
 * and if so, do it" — same item, advance order really is an Advance Order, neither side
 * over-committed past its own remaining balance. Used both by the standalone manual-link
 * endpoint and by the auto-merge path in seller-orders creation, so the rule only lives
 * in one place.
 */
export async function createAdvanceLink(
  db: any,
  {
    advanceOrderId,
    gemOrderId,
    linkedQty,
    linkedBy,
    advanceOrder,
    gemOrder,
  }: {
    advanceOrderId: string;
    gemOrderId: string;
    linkedQty: number;
    linkedBy?: string;
    advanceOrder?: any; // pass already-fetched docs to avoid a re-query when the caller has them
    gemOrder?: any;
  }
): Promise<LinkResult> {
  if (!advanceOrderId || !gemOrderId || !ObjectId.isValid(advanceOrderId) || !ObjectId.isValid(gemOrderId)) {
    return { ok: false, status: 400, error: "Valid advanceOrderId and gemOrderId are required" };
  }
  const qty = round2(Number(linkedQty));
  if (!qty || qty <= 0) {
    return { ok: false, status: 400, error: "linkedQty must be a positive number" };
  }
  if (advanceOrderId === gemOrderId) {
    return { ok: false, status: 400, error: "An order cannot be linked to itself" };
  }

  const orders = db.collection("sellerorders");
  const [resolvedAdvance, resolvedGem] = await Promise.all([
    advanceOrder ?? orders.findOne({ _id: new ObjectId(advanceOrderId) }),
    gemOrder ?? orders.findOne({ _id: new ObjectId(gemOrderId) }),
  ]);
  if (!resolvedAdvance) return { ok: false, status: 404, error: "Advance order not found" };
  if (!resolvedGem) return { ok: false, status: 404, error: "GeM order not found" };

  if (!resolvedAdvance.isAdvanceOrder) {
    return { ok: false, status: 400, error: `${resolvedAdvance.orderNo} is not marked as an Advance Order` };
  }
  if (resolvedGem.isAdvanceOrder) {
    return { ok: false, status: 400, error: "An Advance Order cannot be used to cover another Advance Order" };
  }
  if (String(resolvedAdvance.itemId) !== String(resolvedGem.itemId)) {
    return { ok: false, status: 400, error: "Both orders must be for the same item to be linked" };
  }

  const [advanceRemaining, gemRemaining] = await Promise.all([
    getRemainingOut(db, advanceOrderId, resolvedAdvance.reQty),
    getRemainingIn(db, gemOrderId, resolvedGem.reQty),
  ]);

  if (qty > advanceRemaining) {
    return { ok: false, status: 400, error: `Only ${advanceRemaining} unit(s) of ${resolvedAdvance.orderNo} remain unlinked` };
  }
  if (qty > gemRemaining) {
    return { ok: false, status: 400, error: `${resolvedGem.orderNo} only has ${gemRemaining} unit(s) left uncovered` };
  }

  const doc = {
    advanceOrderId,
    advanceOrderNo: resolvedAdvance.orderNo,
    gemOrderId,
    gemOrderNo: resolvedGem.orderNo,
    itemId: String(resolvedAdvance.itemId),
    itemName: resolvedAdvance.itemName,
    linkedQty: qty,
    linkedBy: linkedBy || "",
    linkedAt: new Date(),
  };
  const result = await db.collection("advance_order_links").insertOne(doc);

  return { ok: true, status: 201, doc: { ...doc, _id: result.insertedId } };
}
