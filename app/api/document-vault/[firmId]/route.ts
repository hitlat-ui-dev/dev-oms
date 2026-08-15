import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import mongoose from "mongoose";
import clientPromise from "@/lib/mongodb";
import FirmDocumentVault from "@/models/FirmDocumentVault";
import { uploadFileToR2, deleteFileFromR2 } from "@/lib/cloudflareR2";

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
const FIXED_KIND_CONTENT_TYPE: Record<FixedKind, string> = {
  letterhead: "application/pdf",
  sign: "image/png",
  stamp: "image/png",
};

function sanitizeFieldName(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9 _-]/g, "").replace(/\s+/g, "_").slice(0, 60) || "document";
}

// GET: fetch (or lazily create) the firm's document vault.
export async function GET(_req: Request, { params }: { params: Promise<{ firmId: string }> }) {
  try {
    const { firmId } = await params;
    if (!ObjectId.isValid(firmId)) {
      return NextResponse.json({ error: "Invalid firm id" }, { status: 400 });
    }
    await connectMongoose();

    let vault = await FirmDocumentVault.findOne({ firmId });
    if (!vault) {
      vault = await FirmDocumentVault.create({ firmId, documents: [] });
    }
    return NextResponse.json(vault);
  } catch (error: any) {
    console.error("Document vault GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to load document vault" }, { status: 500 });
  }
}

// POST: multipart/form-data — { kind: "custom"|"letterhead"|"sign"|"stamp", file, fieldName? }
// Uploads to R2 and records the key on the firm's vault doc. Replacing an
// existing slot (same custom field name, or any of the fixed letterhead/
// sign/stamp slots) deletes the old R2 object first.
export async function POST(req: Request, { params }: { params: Promise<{ firmId: string }> }) {
  try {
    const { firmId } = await params;
    if (!ObjectId.isValid(firmId)) {
      return NextResponse.json({ error: "Invalid firm id" }, { status: 400 });
    }

    const formData = await req.formData();
    const kind = String(formData.get("kind") || "");
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A file is required" }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());

    await connectMongoose();
    let vault = await FirmDocumentVault.findOne({ firmId });
    if (!vault) vault = await FirmDocumentVault.create({ firmId, documents: [] });

    if (kind === "custom") {
      const rawName = String(formData.get("fieldName") || "").trim();
      if (!rawName) {
        return NextResponse.json({ error: "fieldName is required for a custom document" }, { status: 400 });
      }
      const safeName = sanitizeFieldName(rawName);
      const key = `firms/${firmId}/documents/${safeName}-${Date.now()}.pdf`;

      const existing = vault.documents.find((d: any) => d.name.toLowerCase() === rawName.toLowerCase());
      if (existing) {
        try {
          await deleteFileFromR2(existing.r2Key);
        } catch (err) {
          console.error("Failed to delete old vault document from R2 (continuing):", err);
        }
        vault.documents = vault.documents.filter((d: any) => d.name.toLowerCase() !== rawName.toLowerCase());
      }

      await uploadFileToR2(buffer, key, file.type || "application/pdf");
      vault.documents.push({ name: rawName, r2Key: key, originalFileName: file.name, uploadedAt: new Date() });
      await vault.save();
      return NextResponse.json(vault);
    }

    if (FIXED_KINDS.includes(kind as FixedKind)) {
      const fixedKind = kind as FixedKind;
      const field = FIXED_KIND_FIELD[fixedKind];
      const key = `firms/${firmId}/${fixedKind}.${fixedKind === "letterhead" ? "pdf" : "png"}`;

      const oldKey = (vault as any)[field];
      if (oldKey) {
        try {
          await deleteFileFromR2(oldKey);
        } catch (err) {
          console.error("Failed to delete old firm asset from R2 (continuing):", err);
        }
      }

      await uploadFileToR2(buffer, key, file.type || FIXED_KIND_CONTENT_TYPE[fixedKind]);
      (vault as any)[field] = key;
      await vault.save();
      return NextResponse.json(vault);
    }

    return NextResponse.json({ error: "kind must be custom, letterhead, sign or stamp" }, { status: 400 });
  } catch (error: any) {
    console.error("Document vault POST error:", error);
    return NextResponse.json({ error: error.message || "Upload failed — check R2 connection" }, { status: 500 });
  }
}

// DELETE: ?kind=custom&name=... or ?kind=letterhead|sign|stamp
export async function DELETE(req: Request, { params }: { params: Promise<{ firmId: string }> }) {
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

    if (kind === "custom") {
      const name = searchParams.get("name") || "";
      const existing = vault.documents.find((d: any) => d.name === name);
      if (!existing) return NextResponse.json({ error: "Document not found" }, { status: 404 });

      await deleteFileFromR2(existing.r2Key);
      vault.documents = vault.documents.filter((d: any) => d.name !== name);
      await vault.save();
      return NextResponse.json(vault);
    }

    if (FIXED_KINDS.includes(kind as FixedKind)) {
      const field = FIXED_KIND_FIELD[kind as FixedKind];
      const key = (vault as any)[field];
      if (key) await deleteFileFromR2(key);
      (vault as any)[field] = null;
      await vault.save();
      return NextResponse.json(vault);
    }

    return NextResponse.json({ error: "kind must be custom, letterhead, sign or stamp" }, { status: 400 });
  } catch (error: any) {
    console.error("Document vault DELETE error:", error);
    return NextResponse.json({ error: error.message || "Delete failed — check R2 connection" }, { status: 500 });
  }
}
