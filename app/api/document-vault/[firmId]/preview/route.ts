import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import mongoose from "mongoose";
import clientPromise from "@/lib/mongodb";
import FirmDocumentVault from "@/models/FirmDocumentVault";
import { getSignedDownloadUrl } from "@/lib/cloudflareR2";

async function connectMongoose() {
  await clientPromise;
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI as string);
  }
}

const FIXED_KINDS = ["letterhead", "sign", "stamp"] as const;
type FixedKind = (typeof FIXED_KINDS)[number];
const FIXED_KIND_FIELD: Record<FixedKind, "letterheadKey" | "signKey" | "stampKey"> = {
  letterhead: "letterheadKey",
  sign: "signKey",
  stamp: "stampKey",
};

// GET ?kind=custom&name=X or ?kind=letterhead|sign|stamp — a short-lived
// signed URL for viewing one vault document/asset in a new tab, next to its
// Delete button. Mirrors the same key lookup the main [firmId] route uses
// for upload/delete, just resolving to a viewable URL instead.
export async function GET(req: Request, { params }: { params: Promise<{ firmId: string }> }) {
  try {
    const { firmId } = await params;
    if (!ObjectId.isValid(firmId)) {
      return NextResponse.json({ error: "Invalid firm id" }, { status: 400 });
    }
    const { searchParams } = new URL(req.url);
    const kind = searchParams.get("kind") || "";

    await connectMongoose();
    const vault = await FirmDocumentVault.findOne({ firmId });
    if (!vault) return NextResponse.json({ error: "Vault not found" }, { status: 404 });

    let key: string | null = null;
    if (kind === "custom") {
      const name = searchParams.get("name") || "";
      const doc = vault.documents.find((d: any) => d.name === name);
      if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
      key = doc.r2Key;
    } else if (FIXED_KINDS.includes(kind as FixedKind)) {
      key = (vault as any)[FIXED_KIND_FIELD[kind as FixedKind]] || null;
    } else {
      return NextResponse.json({ error: "kind must be custom, letterhead, sign or stamp" }, { status: 400 });
    }

    if (!key) return NextResponse.json({ error: "Nothing uploaded for this slot yet" }, { status: 404 });

    const url = await getSignedDownloadUrl(key, 300);
    return NextResponse.json({ url });
  } catch (error: any) {
    console.error("Document vault preview error:", error);
    return NextResponse.json({ error: error.message || "Failed to build preview link" }, { status: 500 });
  }
}
