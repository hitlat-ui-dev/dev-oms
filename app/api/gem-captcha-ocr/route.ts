import { NextResponse } from "next/server";
import { extractCaptchaTextFromImage } from "@/lib/gemini";

// POST /api/gem-captcha-ocr — { imageDataUrl: "data:image/png;base64,..." }
// Called DIRECTLY from the GeM Bill Auto-Submit browser extension's content
// script (content-gem.js), not relayed through its background service
// worker - that relay was tried first, but a background fetch() risks being
// cut off mid-request by MV3's service-worker lifecycle (confirmed live
// 19-Sep-2026: "message channel closed before a response was received"
// errors even with a keep-alive ping running). A content script's own
// fetch has no such lifecycle limit.
//
// Chrome subjects a content script's fetch to the HOST PAGE's CORS policy
// (unlike a background/extension-page fetch, which bypasses CORS via
// host_permissions) - sso.gem.gov.in / admin-mkp.gem.gov.in calling this
// cross-origin therefore needs this route to opt in itself via CORS_HEADERS
// below. No auth/session data is involved (same no-session pattern as the
// extension's other gem-sync callbacks), so a wildcard origin is fine.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  // Chrome's Private Network Access check (confirmed live 19-Sep-2026:
  // "blocked by CORS policy: Permission was denied for this request to
  // access the `loopback` address space") - a public page (admin-mkp.gem.gov.in)
  // fetching a loopback address (localhost, during local dev only; this
  // never applies once the extension points at the deployed origin) needs
  // this explicit opt-in on the PREFLIGHT response before Chrome allows it.
  "Access-Control-Allow-Private-Network": "true",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  try {
    const { imageDataUrl } = await req.json();
    const match = typeof imageDataUrl === "string" && imageDataUrl.match(/^data:(.+?);base64,(.+)$/);
    if (!match) {
      return NextResponse.json({ error: "imageDataUrl (base64 data URL) is required" }, { status: 400, headers: CORS_HEADERS });
    }

    const [, mimeType, base64] = match;
    const buffer = Buffer.from(base64, "base64");
    const text = await extractCaptchaTextFromImage(buffer, mimeType);

    return NextResponse.json({ text }, { headers: CORS_HEADERS });
  } catch (error: any) {
    console.error("Captcha OCR error:", error);
    return NextResponse.json({ error: error.message || "Captcha OCR failed" }, { status: 500, headers: CORS_HEADERS });
  }
}
