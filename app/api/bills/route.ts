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
    const bills = await db.collection("bills").find(query).sort({ invoiceDate: -1, createdAt: -1 }).toArray();

    return NextResponse.json(bills);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch bills" }, { status: 500 });
  }
}
