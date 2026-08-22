import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

// GET /api/bills?firmCode=XXX&from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const firmCode = (searchParams.get("firmCode") || "").trim().toUpperCase();
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    const query: any = {};
    if (firmCode) query.firmCode = firmCode;
    if (from || to) {
      query.invoiceDate = {};
      if (from) query.invoiceDate.$gte = new Date(`${from}T00:00:00`);
      if (to) query.invoiceDate.$lte = new Date(`${to}T23:59:59`);
    }

    const client = await clientPromise;
    const db = client.db();

    // contractDate isn't stored on the Bill doc itself (only on the seller
    // orders it was generated from) - looked up here so Bill History can
    // show it without needing a schema migration for bills already generated.
    const bills = await db.collection("bills").aggregate([
      { $match: query },
      { $sort: { invoiceDate: -1, createdAt: -1 } },
      {
        $lookup: {
          from: "sellerorders",
          let: { fc: "$firmCode", cn: "$contractNo" },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ["$firmCode", "$$fc"] }, { $eq: ["$contractNo", "$$cn"] }] } } },
            { $limit: 1 },
            { $project: { _id: 0, contractDate: 1 } },
          ],
          as: "_contractLookup",
        },
      },
      { $addFields: { contractDate: { $arrayElemAt: ["$_contractLookup.contractDate", 0] } } },
      { $project: { _contractLookup: 0 } },
    ]).toArray();

    return NextResponse.json(bills);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch bills" }, { status: 500 });
  }
}
