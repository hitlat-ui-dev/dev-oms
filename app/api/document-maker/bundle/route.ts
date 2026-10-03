import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import mongoose from "mongoose";
import JSZip from "jszip";
import clientPromise from "@/lib/mongodb";
import FirmDocumentVault from "@/models/FirmDocumentVault";
import { getFileFromR2, uploadFileToR2, getSignedDownloadUrl } from "@/lib/cloudflareR2";
import { mergePdfs, overlaySignStamp, splitBySizeAndPages } from "@/lib/documentMaker/pdfEngine";
import { buildAtcDocument } from "@/lib/documentMaker/buildAtcDocument";

// Rendering the ATC (image-based) plus merging/splitting/zipping everything
// else can take a while for a bid with a multi-page ATC and several
// supporting documents - same reasoning as the standalone ATC route.
export const maxDuration = 90;

async function connectMongoose() {
  await clientPromise;
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI as string);
  }
}

/** First part is "ATC_ALL_", every part after that is "ATC_ALL_2", "ATC_ALL_3", ... (per spec, not the "_partN" convention finalizeOutputNames uses elsewhere). */
function atcAllNames(count: number): string[] {
  if (count <= 1) return ["ATC_ALL_.pdf"];
  return Array.from({ length: count }, (_, i) => (i === 0 ? "ATC_ALL_.pdf" : `ATC_ALL_${i + 1}.pdf`));
}

function sanitizeForPath(s: string): string {
  return String(s || "").replace(/[\\/:*?"<>|]/g, "-").trim() || "document";
}

// POST { firmId, bidId, documentNames: string[] } — the one-click ZIP bundle:
// the bid's real Bid Document and ATC Link document (if fetched - see
// /api/gem-bids/fetch-documents), each individually selected vault document
// on its own, the generated ATC (PDF + Word), and everything merged into one
// "ATC_ALL_" PDF (split at 99 pages/9.5MB) in the exact order the caller
// selected documentNames in. All zipped together and uploaded to R2.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { firmId, bidId, documentNames } = body;

    if (!firmId || !ObjectId.isValid(firmId)) {
      return NextResponse.json({ error: "Valid firmId is required" }, { status: 400 });
    }
    if (!bidId || !ObjectId.isValid(bidId)) {
      return NextResponse.json({ error: "Valid bidId is required" }, { status: 400 });
    }
    const selectedNames: string[] = Array.isArray(documentNames) ? documentNames : [];

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

    const zip = new JSZip();
    const notes: string[] = [];
    const safeBidNo = sanitizeForPath(bid.bidNo || bidId);

    // Raw source documents - as fetched from GeM, untouched (no sign/stamp
    // overlay - that's only applied to the merged ATC_ALL_ bundle below, same
    // as the existing /document-maker/merge route's behavior for selected docs).
    if (bid.bidLinkDoc?.fileKey) {
      try {
        zip.file("Bid Document.pdf", await getFileFromR2(bid.bidLinkDoc.fileKey));
      } catch (err) {
        console.error("Failed to fetch cached Bid Document from R2:", err);
        notes.push("Bid Document couldn't be fetched from storage — left out of the ZIP.");
      }
    } else {
      notes.push('Bid Document not included — click "Fetch Bid Documents" for this bid first.');
    }

    if (bid.bidSpecificAtc?.fileKey) {
      try {
        zip.file("ATC Link Document.pdf", await getFileFromR2(bid.bidSpecificAtc.fileKey));
      } catch (err) {
        console.error("Failed to fetch cached ATC Link document from R2:", err);
        notes.push("ATC Link document couldn't be fetched from storage — left out of the ZIP.");
      }
    } else {
      notes.push("ATC Link document not included — either not fetched yet, or this bid has no buyer-added ATC link on GeM.");
    }

    // Selected vault documents - fetched in the exact order the caller's
    // documentNames array lists them (the caller preserves the user's
    // selection order; a Set's iteration order is already insertion order,
    // so no separate reordering UI was needed for this).
    const selectedDocs = selectedNames
      .map((name) => vault.documents.find((d: any) => d.name === name))
      .filter(Boolean) as { name: string; r2Key: string }[];

    const selectedBuffers: Buffer[] = [];
    const docsFolder = zip.folder("Documents");
    for (const doc of selectedDocs) {
      try {
        const bytes = await getFileFromR2(doc.r2Key);
        selectedBuffers.push(bytes);
        docsFolder!.file(`${sanitizeForPath(doc.name)}.pdf`, bytes);
      } catch (err) {
        console.error(`Failed to fetch vault document "${doc.name}" from R2:`, err);
        notes.push(`"${doc.name}" couldn't be fetched from storage — left out of the ZIP and the merged bundle.`);
      }
    }

    // The ATC itself - image-based when the real ATC document was fetched,
    // a text summary cover otherwise (see buildAtcDocument's own note).
    const atcResult = await buildAtcDocument(bid, letterheadBytes, signBytes, stampBytes);
    if (atcResult.note) notes.push(atcResult.note);
    const atcBytes = Buffer.from(await atcResult.pdfDoc.save());
    zip.file("ATC.pdf", atcBytes);
    zip.file("ATC.docx", atcResult.docxBytes);

    // ATC_ALL_: the ATC (already has sign+stamp on every page from
    // buildAtcDocument) followed by the selected documents, stamped as
    // their own subset first so the final concatenation below doesn't
    // double-stamp the ATC's own pages.
    let stampedSelected: Buffer | null = null;
    if (selectedBuffers.length > 0) {
      const selectedMerged = await mergePdfs(selectedBuffers);
      await overlaySignStamp(selectedMerged, signBytes, stampBytes);
      stampedSelected = Buffer.from(await selectedMerged.save());
    }
    const atcAllDoc = await mergePdfs(stampedSelected ? [atcBytes, stampedSelected] : [atcBytes]);
    const atcAllParts = await splitBySizeAndPages(atcAllDoc);
    const atcAllFileNames = atcAllNames(atcAllParts.length);
    atcAllParts.forEach((part, i) => zip.file(atcAllFileNames[i], part));

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const key = `bids/${bidId}/output/ATC-Bundle-${safeBidNo}-${Date.now()}.zip`;
    await uploadFileToR2(zipBuffer, key, "application/zip");

    return NextResponse.json({
      url: await getSignedDownloadUrl(key),
      fileName: `ATC-Bundle-${safeBidNo}.zip`,
      atcMode: atcResult.mode,
      notes,
    });
  } catch (error: any) {
    console.error("Document maker bundle error:", error);
    return NextResponse.json({ error: error.message || "Failed to build ZIP bundle" }, { status: 500 });
  }
}
