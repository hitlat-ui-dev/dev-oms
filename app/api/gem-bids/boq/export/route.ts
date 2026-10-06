import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import clientPromise from "@/lib/mongodb";
import { getFileFromR2, uploadFileToR2, getSignedDownloadUrl } from "@/lib/cloudflareR2";
import { parseBoqXlsx, buildFilledBoqXlsx } from "@/lib/documentMaker/boqEngine";

const DB_NAME = "dev_oms_db";

function sanitizeForPath(s: string): string {
  return String(s || "").replace(/[\\/:*?"<>|]/g, "-").trim() || "BOQ";
}

// GET ?bidId= — rebuilds the BOQ as a downloadable .xlsx with the saved
// Rate column filled in (see ../save/route.ts), for a standalone download
// from Document Maker and for the ZIP bundle to include when rates have
// been saved for the selected bid.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const bidId = searchParams.get("bidId") || "";
    if (!bidId || !ObjectId.isValid(bidId)) {
      return NextResponse.json({ error: "Valid bidId is required" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const bid = await db.collection("gem_bids").findOne({ _id: new ObjectId(bidId) });
    if (!bid) {
      return NextResponse.json({ error: "Bid not found" }, { status: 404 });
    }
    if (!bid.boqDetailDoc?.fileKey) {
      return NextResponse.json({ error: "No BOQ Detail Document fetched for this bid yet" }, { status: 400 });
    }
    if (!bid.boqRates || bid.boqRates.length === 0) {
      return NextResponse.json({ error: "No rates saved yet for this bid's BOQ" }, { status: 400 });
    }

    const boqBytes = await getFileFromR2(bid.boqDetailDoc.fileKey);
    const parsedItems = parseBoqXlsx(boqBytes);
    const rateByItemNumber = new Map<string, string>(
      (bid.boqRates || []).map((r: any) => [String(r.itemNumber), String(r.rate || "")])
    );
    const filledItems = parsedItems.map((it) => ({ ...it, rate: rateByItemNumber.get(it.itemNumber) || "" }));

    const outBytes = buildFilledBoqXlsx(filledItems);
    const safeBidNo = sanitizeForPath(bid.bidNo || bidId);
    const fileName = `BOQ-Filled-${safeBidNo}.xlsx`;
    const key = `bids/${bidId}/output/${fileName}`;
    await uploadFileToR2(outBytes, key, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

    return NextResponse.json({ url: await getSignedDownloadUrl(key, 3600, fileName), fileName });
  } catch (error: any) {
    console.error("GeM bid BOQ export error:", error);
    return NextResponse.json({ error: error.message || "Failed to export BOQ" }, { status: 500 });
  }
}
