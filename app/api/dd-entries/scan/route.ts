import { NextResponse } from "next/server";
import { extractDDDetailsFromImage } from "@/lib/gemini";
import { uploadFileToR2, getSignedDownloadUrl } from "@/lib/cloudflareR2";

// POST /api/dd-entries/scan — multipart/form-data { file }
// Uploads the scanned DD to R2 (dd-scans/ prefix, bills bucket) and runs it
// through Gemini Vision to pre-fill the entry form. The upload always
// succeeds even if OCR extraction fails, so the user can still fall back to
// typing the fields manually with the scan already attached.
export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A file is required" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || "image/jpeg";
    const key = `dd-scans/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

    await uploadFileToR2(buffer, key, mimeType);
    const previewUrl = await getSignedDownloadUrl(key);

    let extracted;
    let ocrError: string | null = null;
    try {
      extracted = await extractDDDetailsFromImage(buffer, mimeType);
    } catch (err: any) {
      console.error("DD scan OCR error:", err);
      ocrError = err.message || "OCR extraction failed";
      extracted = { ddNumber: null, amount: null, ddDate: null, payeeName: null };
    }

    return NextResponse.json({
      scannedDocumentUrl: key,
      previewUrl,
      extracted,
      ocrError,
    });
  } catch (error: any) {
    console.error("DD scan POST error:", error);
    return NextResponse.json({ error: error.message || "Scan upload failed" }, { status: 500 });
  }
}
