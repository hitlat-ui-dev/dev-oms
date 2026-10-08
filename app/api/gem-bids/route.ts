import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { EDITABLE_FIELD_KEYS, DATA_FIELD_KEYS } from "@/lib/gemBids/columns";
import { normalizeForCompare } from "@/lib/gemBids/diffEngine";

const DB_NAME = "dev_oms_db";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

// GET: every stored bid (client filters/sorts/paginates per section — same convention as
// the Orders board, no server-side pagination anywhere else in this app either).
// Deleted bids (deletedAt set) and Expired bids (expiredAt set) are left out
// by default, same as either one used to look from every other tab's
// perspective - ?section=deleted_bids / ?section=expired_bids are the ways
// to see them, for their own tabs. ?section=with_deleted_and_expired
// includes everything (no filtering at all) - used by the All Bids tab,
// which is meant to show where a bid currently sits even if that's one of
// those two holding areas, without counting them in its own badge (the
// frontend keeps that count from the plain unfiltered fetch separately).
// ?light=1 returns just {_id, bidNo, items, currentSection, address,
// departmentNameAndAddress, boqDetailDoc, selectedPartyIds, selectedPartyId,
// bidLink, buyerAddedBidSpecificAtcUrl, bidToRaEnabled, raQualificationRule,
// typeOfBid, evaluationMethod, emdAmount, bidEndDateTime} - the Bid Rate page's bid picker
// needs enough to populate/filter its dropdown, guess the matched institute
// client-side (see lib/gemBids/instituteMatch.ts), know whether a BOQ
// source file already exists for a bid, auto-pick the firm a bid's party
// was already set to, and show the bid's own key details once picked, not
// full bid documents.
// ?section=<key> narrows to one section server-side - used by the sync bridge to
// fetch just the Submitted Bids bidNos it needs to status-check, without pulling
// every bid over the wire for that.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const light = searchParams.get("light");
    const section = searchParams.get("section");

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const liveOnly = { deletedAt: { $exists: false }, expiredAt: { $exists: false } };
    const query =
      section === "deleted_bids"
        ? { deletedAt: { $exists: true, $ne: null } }
        : section === "expired_bids"
        ? { expiredAt: { $exists: true, $ne: null } }
        : section === "with_deleted_and_expired"
        ? {}
        : section
        ? { currentSection: section, ...liveOnly }
        : liveOnly;
    const bids = await db
      .collection("gem_bids")
      .find(
        query,
        light
          ? {
              projection: {
                bidNo: 1,
                items: 1,
                currentSection: 1,
                address: 1,
                departmentNameAndAddress: 1,
                boqDetailDoc: 1,
                selectedPartyIds: 1,
                selectedPartyId: 1,
                bidLink: 1,
                buyerAddedBidSpecificAtcUrl: 1,
                bidToRaEnabled: 1,
                raQualificationRule: 1,
                typeOfBid: 1,
                evaluationMethod: 1,
                emdAmount: 1,
                bidEndDateTime: 1,
              },
            }
          : undefined
      )
      .sort({ updatedAt: -1 })
      .toArray();
    return NextResponse.json(bids, { headers: corsHeaders });
  } catch (error: any) {
    console.error("GeM bids GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch bids" }, { status: 500, headers: corsHeaders });
  }
}

// PATCH: manually correct a bid's own fields. body: { bidNo, fields: Record<string,string>, editedBy? }
// Freely repeatable - manuallyEdited/editedAt/editedBy are recorded as an
// audit trail (who last touched it, when), not a one-time lock. Only
// EDITABLE_FIELD_KEYS-listed fields are writable; bidNo (the identity key),
// the locked fields (Bid Link, Bid End Date/Time, Items, QTY, Evaluation
// Method, Bid To RA, RA Qualification Rule - the scrape gets these right and
// other logic depends on them), and internal workflow fields (currentSection,
// tag, etc.) can't be touched from here even if sent.
//
// Every field genuinely changed here (not just submitted - the Edit Bid
// modal sends the whole form, most of it unchanged) is added to
// manuallyEditedFields, a standing per-field allowlist applyImport.ts
// checks on every future sync: a field on that list keeps the user's value
// instead of being silently overwritten by GeM's own data for it, even if
// GeM's data has since changed (see applyImport.ts's own comment for the
// "but still flag it" half of that).
export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { bidNo, fields, editedBy } = body;
    if (!bidNo || typeof bidNo !== "string") {
      return NextResponse.json({ error: "bidNo is required" }, { status: 400, headers: corsHeaders });
    }
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
      return NextResponse.json({ error: "fields must be an object" }, { status: 400, headers: corsHeaders });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const bidsCollection = db.collection("gem_bids");

    const existing = await bidsCollection.findOne({ bidNo });
    if (!existing) {
      return NextResponse.json({ error: "Bid not found" }, { status: 404, headers: corsHeaders });
    }

    const setDoc: Record<string, string> = {};
    const newlyEditedFields: string[] = [];
    for (const key of EDITABLE_FIELD_KEYS) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        const nextVal = String(fields[key] ?? "").trim();
        setDoc[key] = nextVal;
        if (normalizeForCompare(existing[key]) !== normalizeForCompare(nextVal)) {
          newlyEditedFields.push(key);
        }
      }
    }
    const manuallyEditedFields = Array.from(new Set([...(existing.manuallyEditedFields || []), ...newlyEditedFields]));

    const now = new Date();
    await bidsCollection.updateOne(
      { bidNo },
      {
        $set: {
          ...setDoc,
          manuallyEdited: true,
          manuallyEditedAt: now,
          manuallyEditedBy: editedBy || "",
          manuallyEditedFields,
          updatedAt: now,
        },
      }
    );
    const updated = await bidsCollection.findOne({ bidNo });

    return NextResponse.json({ success: true, bid: updated }, { headers: corsHeaders });
  } catch (error: any) {
    console.error("GeM bid PATCH error:", error);
    return NextResponse.json({ error: error.message || "Edit failed" }, { status: 500, headers: corsHeaders });
  }
}

// DELETE: soft-delete one or more bids by Bid No - available on every
// section (New Bids and Submitted Bids included). Sets deletedAt rather
// than actually removing the doc, so it still shows (in the Deleted Bids
// tab only - see GET above) for a 7-day grace window before
// /api/gem-bids/purge-deleted removes it for good; change/move history
// rows are kept as an audit trail regardless.
//
// Also writes/refreshes a standing tombstone per bidNo (a snapshot of its
// scraped fields at delete time) that outlives the 7-day window and the
// eventual purge - applyImport.ts checks it on every future sync so a
// deleted bid doesn't just come back on the next scrape, unless GeM's own
// data for it has genuinely changed since the delete.
export async function DELETE(req: Request) {
  try {
    const body = await req.json();
    const { bidNos } = body;
    if (!Array.isArray(bidNos) || bidNos.length === 0) {
      return NextResponse.json({ error: "bidNos are required" }, { status: 400, headers: corsHeaders });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const bidsCollection = db.collection("gem_bids");
    const tombstonesCollection = db.collection("gem_bid_tombstones");

    const toDelete = await bidsCollection.find({ bidNo: { $in: bidNos } }).toArray();
    const now = new Date();

    if (toDelete.length > 0) {
      const tombstoneOps = toDelete.map((bid: any) => ({
        updateOne: {
          filter: { bidNo: bid.bidNo },
          update: {
            $set: {
              bidNo: bid.bidNo,
              deletedAt: now,
              snapshot: Object.fromEntries(DATA_FIELD_KEYS.map((k) => [k, String(bid[k] ?? "")])),
            },
          },
          upsert: true,
        },
      }));
      await tombstonesCollection.bulkWrite(tombstoneOps, { ordered: false });
    }

    const result = await bidsCollection.updateMany({ bidNo: { $in: bidNos } }, { $set: { deletedAt: now } });

    return NextResponse.json({ success: true, deletedCount: result.modifiedCount || 0 }, { headers: corsHeaders });
  } catch (error: any) {
    console.error("GeM bids DELETE error:", error);
    return NextResponse.json({ error: error.message || "Delete failed" }, { status: 500, headers: corsHeaders });
  }
}
