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

// Standalone Delivery Challans - manually composed dispatch documents with
// their own firm-wise, FY-wise number. Separate from the order-derived challan
// the Orders page renders client-side, which is never stored.
//
// Note the folder name: the WhatsApp send-queue routes under
// /api/delivery-challan (singular) belong to that OTHER, order-linked challan.

const COLLECTION = "delivery_challans";

/** A malformed id in the request body is data to ignore, not a 500 - new
 * ObjectId() throws on anything that isn't a valid id. */
const toObjectIdOrNull = (id: string) => (ObjectId.isValid(id) ? new ObjectId(id) : null);

// GET /api/delivery-challans - list for the history table. Optional filters:
// firmCode, status, dateFrom/dateTo (yyyy-mm-dd), q (free text over DC number,
// consignee and item names).
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const firmCode = (searchParams.get("firmCode") || "").trim().toUpperCase();
    const status = (searchParams.get("status") || "").trim();
    const dateFrom = (searchParams.get("dateFrom") || "").trim();
    const dateTo = (searchParams.get("dateTo") || "").trim();
    const q = (searchParams.get("q") || "").trim();
    const limit = Math.min(Number(searchParams.get("limit")) || 200, 500);

    const filter: Record<string, any> = {};
    if (firmCode) filter.firmCode = firmCode;
    if (status === "draft" || status === "finalized") filter.status = status;

    if (dateFrom || dateTo) {
      filter.date = {};
      if (dateFrom) filter.date.$gte = new Date(`${dateFrom}T00:00:00`);
      // Inclusive of the whole end day - a challan dated 12/09 must appear in
      // a 01/09-12/09 range, not fall off the end at midnight.
      if (dateTo) filter.date.$lte = new Date(`${dateTo}T23:59:59.999`);
    }

    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [
        { dcNumberFormatted: rx },
        { "consignee.instituteName": rx },
        { "consignee.buyerName": rx },
        { "items.itemName": rx },
        { remarks: rx },
      ];
    }

    const client = await clientPromise;
    const db = client.db();
    const challans = await db
      .collection(COLLECTION)
      .find(filter)
      .sort({ date: -1, createdAt: -1 })
      .limit(limit)
      .toArray();

    return NextResponse.json({ success: true, challans });
  } catch (error: any) {
    console.error("GET delivery-challans error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch challans" }, { status: 500 });
  }
}

// POST /api/delivery-challans - saves a new challan as a DRAFT. No number is
// allocated here: a number is claimed only at finalize (see [id]/finalize), so
// abandoned drafts never burn one and the issued series has no holes in it.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const firmCode = (body.firmCode || "").toString().trim().toUpperCase();

    const client = await clientPromise;
    const db = client.db();

    // Picking a firm is OPTIONAL. Without one the challan prints no firm
    // header and its number comes from the shared no-firm series instead of
    // any firm's own (see lib/dcNumbering.ts).
    const company = firmCode ? await db.collection("companies").findOne({ firmCode }) : null;
    if (firmCode && !company) {
      return NextResponse.json({ error: "Firm not found." }, { status: 404 });
    }

    let items;
    try {
      items = normaliseItems(body.items, toObjectIdOrNull);
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }

    const sellerId = body?.consignee?.sellerId;
    const seller =
      sellerId && ObjectId.isValid(String(sellerId))
        ? await db.collection("sellers").findOne({ _id: new ObjectId(String(sellerId)) })
        : null;

    // The challan's own date drives which FY its number comes from - a challan
    // back-dated to March must take a number from the previous FY's series,
    // not today's.
    const date = body.date ? parseFormDate(body.date) : new Date();
    if (!date) {
      return NextResponse.json({ error: "Invalid date." }, { status: 400 });
    }

    const doc = {
      firmCode,
      dcNumber: null,
      financialYear: shortFinancialYear(getFinancialYear(date)),
      dcNumberFormatted: "",
      numberMode: body.numberMode === "manual" ? "manual" : "auto",
      date,
      consignee: consigneeOf(body, seller, toObjectIdOrNull),
      firmSnapshot: firmSnapshotOf(company),
      items,
      totalQty: totalQtyOf(items),
      remarks: (body.remarks || "").toString().trim(),
      status: "draft" as const,
      r2Key: "",
      createdBy: (body.createdBy || "").toString().trim(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db.collection(COLLECTION).insertOne(doc);

    await bumpItemMasterUsage(db, items);

    return NextResponse.json(
      { success: true, challanId: result.insertedId, challan: { ...doc, _id: result.insertedId } },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("POST delivery-challans error:", error);
    return NextResponse.json({ error: error.message || "Failed to save challan" }, { status: 500 });
  }
}

/** Bumps usageCount on each master item this challan used, so the dropdown can
 * float the everyday items to the top. Best-effort: a challan is already saved
 * by the time this runs, and a failed counter update must not fail the save. */
async function bumpItemMasterUsage(db: any, items: { itemMasterId: any }[]) {
  const ids = items.map((it) => it.itemMasterId).filter(Boolean);
  if (ids.length === 0) return;
  try {
    await db.collection("dc_item_masters").updateMany({ _id: { $in: ids } }, { $inc: { usageCount: 1 } });
  } catch (err: any) {
    console.error("DC item master usage bump failed (challan still saved):", err.message);
  }
}
