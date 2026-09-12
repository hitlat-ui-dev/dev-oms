import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import {
  consigneeOf,
  firmSnapshotOf,
  normaliseItems,
  parseFormDate,
  totalQtyOf,
} from "@/lib/deliveryChallan";
import { getFinancialYear, shortFinancialYear } from "@/lib/dcNumbering";

const COLLECTION = "delivery_challans";

/** A malformed id in the request body is data to ignore, not a 500 - new
 * ObjectId() throws on anything that isn't a valid id. */
const toObjectIdOrNull = (id: string) => (ObjectId.isValid(id) ? new ObjectId(id) : null);

// GET /api/delivery-challans/[id] - one challan, for reopening it on the form.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid challan id" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db();
    const challan = await db.collection(COLLECTION).findOne({ _id: new ObjectId(id) });
    if (!challan) {
      return NextResponse.json({ error: "Challan not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, challan });
  } catch (error: any) {
    console.error("GET delivery-challan error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch challan" }, { status: 500 });
  }
}

// PATCH /api/delivery-challans/[id] - edit a challan.
//
// A FINALIZED challan stays editable (its items, consignee and remarks), which
// is the "allow edit + regenerate" half of the spec's finalize behaviour - a
// wrong qty caught after printing is fixed here and the PDF re-rendered. What
// can never change is its identity: number, firm and FY are locked once
// issued, so an issued number can't quietly move to a different document. The
// stored PDF is dropped so the next download re-renders from the new content
// rather than serving the stale copy out of R2.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid challan id" }, { status: 400 });
    }

    const body = await req.json();
    const client = await clientPromise;
    const db = client.db();

    const existing = await db.collection(COLLECTION).findOne({ _id: new ObjectId(id) });
    if (!existing) {
      return NextResponse.json({ error: "Challan not found" }, { status: 404 });
    }

    const update: Record<string, any> = { updatedAt: new Date() };

    if (body.items !== undefined) {
      let items;
      try {
        items = normaliseItems(body.items, toObjectIdOrNull);
      } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      if (existing.status === "finalized" && items.length === 0) {
        return NextResponse.json({ error: "An issued challan must keep at least one item." }, { status: 400 });
      }
      update.items = items;
      update.totalQty = totalQtyOf(items);
    }

    if (body.remarks !== undefined) {
      update.remarks = (body.remarks || "").toString().trim();
    }

    if (body.consignee !== undefined) {
      const sellerId = body?.consignee?.sellerId;
      const seller =
        sellerId && ObjectId.isValid(String(sellerId))
          ? await db.collection("sellers").findOne({ _id: new ObjectId(String(sellerId)) })
          : null;
      update.consignee = consigneeOf(body, seller, toObjectIdOrNull);
    }

    // Firm and date are only movable while the challan is still a draft -
    // both feed the number it will be issued under.
    if (existing.status === "draft") {
      if (body.firmCode !== undefined) {
        const firmCode = (body.firmCode || "").toString().trim().toUpperCase();
        const company = await db.collection("companies").findOne({ firmCode });
        if (!company) {
          return NextResponse.json({ error: "Firm not found." }, { status: 404 });
        }
        update.firmCode = firmCode;
        update.firmSnapshot = firmSnapshotOf(company);
      }

      if (body.date !== undefined) {
        const date = parseFormDate(body.date);
        if (!date) {
          return NextResponse.json({ error: "Invalid date." }, { status: 400 });
        }
        update.date = date;
        update.financialYear = shortFinancialYear(getFinancialYear(date));
      }

      if (body.numberMode !== undefined) {
        update.numberMode = body.numberMode === "manual" ? "manual" : "auto";
      }
    }

    // Any content change invalidates the stored PDF. Only the R2 pointer is
    // cleared, not the object itself: the key is rebuilt from the same DC
    // number on regenerate, so the upload overwrites it anyway.
    const contentChanged =
      update.items !== undefined || update.consignee !== undefined || update.remarks !== undefined || update.date !== undefined;
    if (contentChanged && existing.r2Key) {
      update.r2Key = "";
    }

    await db.collection(COLLECTION).updateOne({ _id: new ObjectId(id) }, { $set: update });
    const challan = await db.collection(COLLECTION).findOne({ _id: new ObjectId(id) });

    return NextResponse.json({ success: true, challan });
  } catch (error: any) {
    console.error("PATCH delivery-challan error:", error);
    return NextResponse.json({ error: error.message || "Failed to update challan" }, { status: 500 });
  }
}

// DELETE /api/delivery-challans/[id] - drafts only.
//
// A finalized challan is never deleted: its number has been issued on a
// document that physically left with the goods, and deleting the record would
// leave an unexplained hole in the firm's series. Correct it via PATCH instead.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid challan id" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db();
    const existing = await db.collection(COLLECTION).findOne({ _id: new ObjectId(id) });
    if (!existing) {
      return NextResponse.json({ error: "Challan not found" }, { status: 404 });
    }
    if (existing.status === "finalized") {
      return NextResponse.json(
        { error: `DC ${existing.dcNumberFormatted} is already issued and can't be deleted - edit it instead.` },
        { status: 400 }
      );
    }

    await db.collection(COLLECTION).deleteOne({ _id: new ObjectId(id) });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE delivery-challan error:", error);
    return NextResponse.json({ error: error.message || "Failed to delete challan" }, { status: 500 });
  }
}
