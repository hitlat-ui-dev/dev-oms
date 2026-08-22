import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

function getCurrentFY(): string {
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-${String(year + 1).slice(-2)}`;
}

// POST /api/bills/[id]/regenerate - undoes a mistakenly-generated bill:
// deletes the Bill doc and un-links the seller orders it was created from
// (billId back to null) so they reappear in "Un-billed Contracts" and can be
// billed again. Only allowed before GeM's own invoice has been fetched -
// once that's uploaded, GeM's side is locked in and regenerating the OMS
// copy would create a permanent mismatch between the two.
//
// Tries to give back the SAME invoice number (rather than skip to a new
// one): only safe if no newer bill has been issued for this firm+FY since -
// otherwise the firm's counter can't roll back without colliding with that
// newer bill, and the next Generate Bill will issue a fresh number instead.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid bill id" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db();

    const bill = await db.collection("bills").findOne({ _id: new ObjectId(id) });
    if (!bill) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    }
    if (bill.gemDocumentR2Key) {
      return NextResponse.json(
        { error: "GeM's own invoice is already generated/uploaded for this bill - it can't be regenerated anymore." },
        { status: 400 }
      );
    }
    if (bill.cancelled) {
      return NextResponse.json({ error: "This bill is cancelled - nothing to regenerate." }, { status: 400 });
    }

    const sellerOrderIds = (bill.items || []).map((it: any) => it.sellerOrderId).filter(Boolean);

    if (sellerOrderIds.length) {
      await db.collection("sellerorders").updateMany(
        { _id: { $in: sellerOrderIds } },
        { $set: { billId: null }, $unset: { invoiceNumber: "" } }
      );
    }

    // Try to reclaim the same invoice number - only if it was the last one
    // issued for this firm+FY (nothing newer would collide).
    let numberReclaimed = false;
    const company = await db.collection("companies").findOne({ firmCode: bill.firmCode });
    const prefix = company?.invoiceNumbering?.prefix || "";
    const numericPart = Number(String(bill.invoiceNumber || "").replace(prefix, "").trim());
    if (!isNaN(numericPart)) {
      const fy = getCurrentFY();
      const rollback = await db.collection("companies").findOneAndUpdate(
        { firmCode: bill.firmCode, "invoiceNumbering.history.fy": fy, "invoiceNumbering.history.lastNumber": numericPart },
        { $inc: { "invoiceNumbering.history.$.lastNumber": -1 } }
      );
      numberReclaimed = !!(rollback?.value || rollback);
    }

    await db.collection("bills").deleteOne({ _id: new ObjectId(id) });

    return NextResponse.json({
      success: true,
      contractNo: bill.contractNo,
      firmCode: bill.firmCode,
      invoiceNumber: bill.invoiceNumber,
      numberReclaimed,
    });
  } catch (error: any) {
    console.error("Bill regenerate error:", error);
    return NextResponse.json({ error: error.message || "Regenerate failed" }, { status: 500 });
  }
}
