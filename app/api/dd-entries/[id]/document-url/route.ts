import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { ObjectId } from "mongodb";
import clientPromise from "@/lib/mongodb";
import DDEntry from "@/models/DDEntry";
import { getSignedDownloadUrl } from "@/lib/cloudflareR2";

async function connectMongoose() {
  await clientPromise;
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI as string);
  }
}

// GET /api/dd-entries/:id/document-url — fresh time-limited signed URL to view
// the scanned DD document (the R2 bucket is private, so a raw key is never handed to the client).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    await connectMongoose();

    const entry = await DDEntry.findById(id).select("scannedDocumentUrl").lean<{ scannedDocumentUrl?: string }>();
    if (!entry) return NextResponse.json({ error: "DD entry not found" }, { status: 404 });
    if (!entry.scannedDocumentUrl) return NextResponse.json({ error: "No scanned document attached" }, { status: 404 });

    const url = await getSignedDownloadUrl(entry.scannedDocumentUrl);
    return NextResponse.json({ url });
  } catch (error: any) {
    console.error("DD document-url GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to get document URL" }, { status: 500 });
  }
}
