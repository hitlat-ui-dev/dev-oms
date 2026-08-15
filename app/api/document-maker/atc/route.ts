import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import mongoose from "mongoose";
import clientPromise from "@/lib/mongodb";
import FirmDocumentVault from "@/models/FirmDocumentVault";
import { getFileFromR2, uploadFileToR2, getSignedDownloadUrl } from "@/lib/cloudflareR2";
import { generateAtcContentPage, overlaySignStamp, splitBySizeAndPages, finalizeOutputNames, AtcBidFields } from "@/lib/documentMaker/pdfEngine";

async function connectMongoose() {
  await clientPromise;
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI as string);
  }
}

// POST { firmId, bidId } — fetches the bid's fields from gem_bids, fills them
// onto the firm's letterhead as an ATC cover, stamps sign+stamp bottom-right
// on every page, splits if needed, uploads to R2 and returns download link(s).
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { firmId, bidId } = body;

    if (!firmId || !ObjectId.isValid(firmId)) {
      return NextResponse.json({ error: "Valid firmId is required" }, { status: 400 });
    }
    if (!bidId || !ObjectId.isValid(bidId)) {
      return NextResponse.json({ error: "Valid bidId is required" }, { status: 400 });
    }

    await connectMongoose();
    const client = await clientPromise;
    const db = client.db("dev_oms_db");

    const bid = await db.collection("gem_bids").findOne({ _id: new ObjectId(bidId) });
    if (!bid) {
      return NextResponse.json({ error: "Bid not found" }, { status: 404 });
    }

    const vault = await FirmDocumentVault.findOne({ firmId });
    if (!vault || !vault.letterheadKey) {
      return NextResponse.json({ error: "Upload this firm's letterhead in the Document Vault first" }, { status: 400 });
    }

    let letterheadBytes: Buffer;
    try {
      letterheadBytes = await getFileFromR2(vault.letterheadKey);
    } catch (err) {
      console.error("Failed to fetch letterhead from R2:", err);
      return NextResponse.json({ error: "Could not fetch the letterhead — check R2 connection" }, { status: 502 });
    }

    const fields: AtcBidFields = {
      bidNo: bid.bidNo,
      items: bid.items,
      departmentNameAndAddress: bid.departmentNameAndAddress,
      address: bid.address,
      startDate: bid.startDate,
      bidEndDateTime: bid.bidEndDateTime,
      emdAmount: bid.emdAmount,
      beneficiary: bid.beneficiary,
    };

    const atcDoc = await generateAtcContentPage(letterheadBytes, fields);

    let signBytes: Buffer | null = null;
    let stampBytes: Buffer | null = null;
    try {
      if (vault.signKey) signBytes = await getFileFromR2(vault.signKey);
      if (vault.stampKey) stampBytes = await getFileFromR2(vault.stampKey);
    } catch (err) {
      console.error("Failed to fetch sign/stamp from R2 (continuing without overlay):", err);
    }
    await overlaySignStamp(atcDoc, signBytes, stampBytes);

    const parts = await splitBySizeAndPages(atcDoc);
    const safeBidNo = String(bid.bidNo || bidId).replace(/[^a-zA-Z0-9_-]/g, "_");
    const names = finalizeOutputNames(`ATC-${safeBidNo}.pdf`, parts.length);

    const downloads: { fileName: string; url: string }[] = [];
    for (let i = 0; i < parts.length; i++) {
      const key = `bids/${bidId}/output/${names[i]}`;
      await uploadFileToR2(parts[i], key, "application/pdf");
      downloads.push({ fileName: names[i], url: await getSignedDownloadUrl(key) });
    }

    return NextResponse.json({ partCount: parts.length, downloads });
  } catch (error: any) {
    console.error("ATC generate error:", error);
    return NextResponse.json({ error: error.message || "Failed to generate ATC" }, { status: 500 });
  }
}
