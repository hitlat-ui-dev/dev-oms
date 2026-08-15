import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import mongoose from "mongoose";
import clientPromise from "@/lib/mongodb";
import FirmDocumentVault from "@/models/FirmDocumentVault";
import { getFileFromR2, uploadFileToR2, getSignedDownloadUrl } from "@/lib/cloudflareR2";
import { mergePdfs, overlaySignStamp, splitBySizeAndPages, finalizeOutputNames } from "@/lib/documentMaker/pdfEngine";

async function connectMongoose() {
  await clientPromise;
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI as string);
  }
}

// POST { firmId, documentNames: string[] } — merges the firm's selected vault
// documents, stamps sign+stamp bottom-right on every page, splits if the
// result exceeds the hard page/size caps, uploads each part to R2, and
// returns signed download links (never the bucket/credentials themselves).
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { firmId, documentNames } = body;

    if (!firmId || !ObjectId.isValid(firmId)) {
      return NextResponse.json({ error: "Valid firmId is required" }, { status: 400 });
    }
    if (!Array.isArray(documentNames) || documentNames.length === 0) {
      return NextResponse.json({ error: "Select at least one document" }, { status: 400 });
    }

    await connectMongoose();
    const vault = await FirmDocumentVault.findOne({ firmId });
    if (!vault) {
      return NextResponse.json({ error: "This firm has no documents uploaded yet" }, { status: 404 });
    }

    const selected = vault.documents.filter((d: any) => documentNames.includes(d.name));
    if (selected.length === 0) {
      return NextResponse.json({ error: "None of the selected documents were found in the vault" }, { status: 404 });
    }

    let buffers: Buffer[];
    try {
      buffers = await Promise.all(selected.map((d: any) => getFileFromR2(d.r2Key)));
    } catch (err: any) {
      console.error("Failed to fetch vault documents from R2:", err);
      return NextResponse.json({ error: "Could not fetch one or more documents — check R2 connection" }, { status: 502 });
    }

    const merged = await mergePdfs(buffers);

    let signBytes: Buffer | null = null;
    let stampBytes: Buffer | null = null;
    try {
      if (vault.signKey) signBytes = await getFileFromR2(vault.signKey);
      if (vault.stampKey) stampBytes = await getFileFromR2(vault.stampKey);
    } catch (err) {
      console.error("Failed to fetch sign/stamp from R2 (continuing without overlay):", err);
    }
    await overlaySignStamp(merged, signBytes, stampBytes);

    const parts = await splitBySizeAndPages(merged);
    const timestamp = Date.now();
    const names = finalizeOutputNames("bid-documents.pdf", parts.length);

    const downloads: { fileName: string; url: string }[] = [];
    for (let i = 0; i < parts.length; i++) {
      const key = `firms/${firmId}/generated/${timestamp}/${names[i]}`;
      await uploadFileToR2(parts[i], key, "application/pdf");
      downloads.push({ fileName: names[i], url: await getSignedDownloadUrl(key) });
    }

    return NextResponse.json({ partCount: parts.length, downloads });
  } catch (error: any) {
    console.error("Document maker merge error:", error);
    return NextResponse.json({ error: error.message || "Failed to generate merged document" }, { status: 500 });
  }
}
