import SellerOrder from "@/models/SellerOrder";

// Cancels one seller order and reverses whatever stock impact its current
// status had - mirrors the "STANDARD UPDATE" cancel-transition logic in
// app/api/seller-orders/[id]/route.ts (TO CHECK -> reQty decrement,
// READY TO SHIP -> quantity restored), extracted here so Bill History's
// "Cancel Order" action gets the same correct stock math instead of a
// separately-maintained (and likely drifting) copy of it.
export async function cancelSellerOrder(db: any, orderId: any, userName: string) {
  const originalOrder = await SellerOrder.findById(orderId);
  if (!originalOrder) return null; // order already deleted elsewhere - nothing to cancel
  if (originalOrder.status === "CANCELL ORDER") return originalOrder; // already cancelled, no-op

  const itemSku = originalOrder.sku?.trim();
  const adjustQty = Number(originalOrder.reQty || 0);

  const updated = await SellerOrder.findOneAndUpdate(
    { _id: orderId, status: originalOrder.status },
    { status: "CANCELL ORDER" },
    { new: true }
  );
  if (!updated) {
    throw new Error(`Order ${originalOrder.orderNo} was updated concurrently - try again.`);
  }

  if (itemSku && adjustQty > 0) {
    if (originalOrder.status === "TO CHECK") {
      await db.collection("stock").updateOne({ sku: itemSku }, { $inc: { reQty: -adjustQty } });
      await db.collection("items").updateOne({ sku: itemSku }, { $inc: { reQty: -adjustQty } });
    } else if (originalOrder.status === "READY TO SHIP") {
      await db.collection("stock").updateOne({ sku: itemSku }, { $inc: { quantity: adjustQty } });
      await db.collection("items").updateOne(
        { sku: itemSku },
        {
          $inc: { currentStock: adjustQty },
          $push: {
            history: {
              type: `CANCELL ORDER by ${userName || "Admin"}`,
              qty: adjustQty,
              date: new Date(),
              orderNo: updated.orderNo,
              sellerName: originalOrder.instituteName || "N/A",
              otherDetails: `Order cancelled via Bill History. Stock restored.`,
            },
          } as any,
        }
      );
    }
    // DELIVERY/FULFILLED/HISAB and other terminal statuses have no stock
    // reversal defined in the source route either - left unchanged here too.
  }

  return updated;
}
