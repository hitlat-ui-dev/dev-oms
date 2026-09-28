import { NextResponse } from "next/server";
import { uploadFileToR2, getSignedDownloadUrl } from "@/lib/cloudflareR2";

// POST /api/dd-entries/scan — multipart/form-data { file }
// Uploads the DD PDF to R2 (dd-scans/ prefix, bills bucket) and hands back a
// signed preview URL. No OCR/auto-fill — the entry's fields are always typed
// in manually, this just attaches the document.
export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A file is required" }, { status: 400 });
    }
    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "Only PDF files are accepted." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const key = `dd-scans/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

    await uploadFileToR2(buffer, key, "application/pdf");
    const previewUrl = await getSignedDownloadUrl(key);

    return NextResponse.json({ scannedDocumentUrl: key, previewUrl });
  } catch (error: any) {
    console.error("DD scan POST error:", error);
    return NextResponse.json({ error: error.message || "Scan upload failed" }, { status: 500 });
  }
}
