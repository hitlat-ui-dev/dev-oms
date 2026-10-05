import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import mongoose from "mongoose";
import clientPromise from "@/lib/mongodb";
import FirmDocumentVault from "@/models/FirmDocumentVault";
import { getFileFromR2, uploadFileToR2, getSignedDownloadUrl } from "@/lib/cloudflareR2";
import { splitBySizeAndPages, finalizeOutputNames } from "@/lib/documentMaker/pdfEngine";
import { buildAtcDocument } from "@/lib/documentMaker/buildAtcDocument";

// Image rendering (pdfjs-dist + @napi-rs/canvas) for a multi-page ATC can
// take a few seconds per page - same reasoning as the GeM sync apply route's
// own maxDuration bump.
export const maxDuration = 60;

async function connectMongoose() {
  await clientPromise;
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI as string);
  }
}

// POST { firmId, bidId } — builds the ATC (image-based when the bid's real
// ATC document has been fetched, otherwise a text-summary cover — see
// buildAtcDocument), splits the PDF if needed, uploads the PDF part(s) and
// a Word copy to R2, and returns download link(s) for all of them.
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

    let signBytes: Buffer | null = null;
    let stampBytes: Buffer | null = null;
    try {
      if (vault.signKey) signBytes = await getFileFromR2(vault.signKey);
      if (vault.stampKey) stampBytes = await getFileFromR2(vault.stampKey);
    } catch (err) {
      console.error("Failed to fetch sign/stamp from R2 (continuing without them):", err);
    }

    const { pdfDoc, docxBytes, mode, note } = await buildAtcDocument(bid, letterheadBytes, signBytes, stampBytes);

    const parts = await splitBySizeAndPages(pdfDoc);
    const safeBidNo = String(bid.bidNo || bidId).replace(/[^a-zA-Z0-9_-]/g, "_");
    const names = finalizeOutputNames(`ATC-${safeBidNo}.pdf`, parts.length);

    const downloads: { fileName: string; url: string }[] = [];
    for (let i = 0; i < parts.length; i++) {
      const key = `bids/${bidId}/output/${names[i]}`;
      await uploadFileToR2(parts[i], key, "application/pdf");
      downloads.push({ fileName: names[i], url: await getSignedDownloadUrl(key, 3600, names[i]) });
    }

    const docxName = `ATC-${safeBidNo}.docx`;
    const docxKey = `bids/${bidId}/output/${docxName}`;
    await uploadFileToR2(docxBytes, docxKey, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    downloads.push({ fileName: docxName, url: await getSignedDownloadUrl(docxKey, 3600, docxName) });

    return NextResponse.json({ partCount: parts.length, downloads, mode, note });
  } catch (error: any) {
    console.error("ATC generate error:", error);
    return NextResponse.json({ error: error.message || "Failed to generate ATC" }, { status: 500 });
  }
}
