// Recomputes whether a SKU's stock is in deficit (reorder qty vs. available +
// already-ordered stock) and keeps its auto-generated Purchase Request in
// sync - creates one if newly in deficit, updates its qty if already
// deficient, deletes it once resolved. Called from every place that changes
// a SKU's available stock or reorder qty (seller order create/verify/delete,
// manual stock add/remove) so Purchase Requests never go stale.
export async function syncPurchaseRequest(
  db: any,
  sku: string,
  itemDetails?: { itemId?: string; itemName?: string; category?: string; unit?: string; orderNo?: string }
) {
  if (!sku) return;
  const stockDoc = await db.collection("stock").findOne({ sku: sku });
  if (!stockDoc) return;

  const availableStock = Number(stockDoc.quantity || 0);
  const totalReQty = Number(stockDoc.reQty || 0);

  // Calculate active purchase orders (ordered stock on the way)
  const opOrders = await db.collection("Order place Purchase").find({ sku: sku }).toArray();
  const orderedStock = opOrders.reduce((sum: number, o: any) => sum + Number(o.orderQty || 0), 0);

  const deficit = totalReQty - (availableStock + orderedStock);

  const existingPR = await db.collection("purchase_requests").findOne({
    sku: sku,
    status: "Purchase Request"
  });

  // Get all pending seller orders for this item SKU to aggregate remarks.
  // Every pending order gets a line - institute, item name and the rate it
  // was ordered at - not just the ones that happen to carry their own custom
  // remark text; the order's own remark (if any) is appended after that.
  const pendingOrders = await db.collection("sellerorders").find({ sku: sku, status: "TO CHECK" }).toArray();
  const aggregatedRemark = pendingOrders
    .map((o: any) => {
      const base = `• ${o.instituteName || "Unknown Buyer"}: ${o.itemName || itemDetails?.itemName || ""} @ ₹${o.rate ?? 0}`;
      const customRemark = o.remark && o.remark.trim() !== "" && o.remark.trim() !== "No Remark" ? ` — ${o.remark.trim()}` : "";
      return base + customRemark;
    })
    .join("\n");

  if (deficit > 0) {
    if (existingPR) {
      await db.collection("purchase_requests").updateOne(
        { _id: existingPR._id },
        {
          $set: {
            prQty: deficit,
            remark: aggregatedRemark || "Auto-generated deficit check",
            updatedAt: new Date()
          }
        }
      );
      console.log(`[SYNC PR UPDATE] SKU: ${sku} | Updated PR | Qty: ${existingPR.prQty} → ${deficit}`);
    } else {
      await db.collection("purchase_requests").insertOne({
        itemId: itemDetails?.itemId || String(stockDoc._id || ""),
        itemName: itemDetails?.itemName || stockDoc.itemName || "",
        sku: sku,
        category: itemDetails?.category || stockDoc.category || "GENERAL",
        unit: itemDetails?.unit || stockDoc.unit || "NOS",
        prQty: deficit,
        remark: aggregatedRemark || (itemDetails?.orderNo ? `Auto-generated from Order ${itemDetails.orderNo}` : "Auto-generated deficit check"),
        status: "Purchase Request",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log(`[SYNC PR CREATE] SKU: ${sku} | Created PR | Qty: ${deficit}`);
    }
  } else {
    if (existingPR) {
      await db.collection("purchase_requests").deleteOne({ _id: existingPR._id });
      console.log(`[SYNC PR DELETE] SKU: ${sku} | Deficit resolved, deleted PR`);
    }
  }
}
