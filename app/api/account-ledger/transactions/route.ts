import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

// GET: chronological order-by-order ledger for ONE institute (like a Tally party ledger),
// optionally scoped to a firm and/or a date range (contractDate is stored as "YYYY-MM-DD").
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const instituteName = searchParams.get("instituteName");
    const firmCode = searchParams.get("firmCode");
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    if (!instituteName) {
      return NextResponse.json({ error: "instituteName is required" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db();
    const collection = db.collection("sellerorders");

    const baseMatch: Record<string, any> = { instituteName };
    if (firmCode) baseMatch.firmCode = firmCode;

    // Opening balance = net of everything dated before the "from" cutoff
    let openingBalance = 0;
    if (from) {
      const priorOrders = await collection
        .find({ ...baseMatch, contractDate: { $lt: from } })
        .toArray();
      openingBalance = priorOrders.reduce(
        (sum, o) => sum + (Number(o.totalAmount) || 0) - (o.isPaid ? Number(o.totalAmount) || 0 : 0),
        0
      );
    }

    const rangeMatch: Record<string, any> = { ...baseMatch };
    if (from || to) {
      rangeMatch.contractDate = {};
      if (from) rangeMatch.contractDate.$gte = from;
      if (to) rangeMatch.contractDate.$lte = to;
    }

    const orders = await collection
      .find(rangeMatch)
      .sort({ contractDate: 1, createdAt: 1 })
      .toArray();

    return NextResponse.json({ openingBalance, orders });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch buyer ledger" }, { status: 500 });
  }
}
