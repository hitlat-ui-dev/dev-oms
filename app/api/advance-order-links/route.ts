import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { createAdvanceLink } from "@/lib/advanceOrders";

const DB_NAME = "dev_oms_db";

// GET: every link for one order, from either side (advance order or GeM/fulfillment order),
// for the tracker page's drill-down view.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const advanceOrderId = searchParams.get("advanceOrderId");
    const gemOrderId = searchParams.get("gemOrderId");
    if (!advanceOrderId && !gemOrderId) {
      return NextResponse.json({ error: "advanceOrderId or gemOrderId is required" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const filter: Record<string, any> = {};
    if (advanceOrderId) filter.advanceOrderId = advanceOrderId;
    if (gemOrderId) filter.gemOrderId = gemOrderId;

    const links = await db.collection("advance_order_links").find(filter).sort({ linkedAt: -1 }).toArray();
    return NextResponse.json(links);
  } catch (error: any) {
    console.error("advance-order-links GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch links" }, { status: 500 });
  }
}

// POST: link a later GeM/fulfillment order against an earlier advance order for a given
// quantity. Validated so an advance order can never be linked-out past what it actually
// delivered, and a GeM order can never be linked-in past its own required quantity —
// nothing on either SellerOrder document is touched, only this ledger collection.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { advanceOrderId, gemOrderId, linkedQty, linkedBy } = body;

    const client = await clientPromise;
    const db = client.db(DB_NAME);

    const result = await createAdvanceLink(db, { advanceOrderId, gemOrderId, linkedQty, linkedBy });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.doc, { status: result.status });
  } catch (error: any) {
    console.error("advance-order-links POST error:", error);
    return NextResponse.json({ error: error.message || "Failed to create link" }, { status: 500 });
  }
}
