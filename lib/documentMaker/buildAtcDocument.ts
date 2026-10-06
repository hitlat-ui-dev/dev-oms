import { PDFDocument } from "pdf-lib";
import { getFileFromR2 } from "@/lib/cloudflareR2";
import { generateAtcContentPage, AtcBidFields } from "./pdfEngine";
import { renderPdfPagesToImages, buildImageBasedAtc } from "./imageAtcEngine";
import { buildAtcTextDocx } from "./docxEngine";

export interface BuildAtcResult {
  pdfDoc: PDFDocument;
  docxBytes: Buffer;
  mode: "image" | "text_fallback";
  note?: string;
}

function atcFieldsFor(bid: any): AtcBidFields {
  return {
    bidNo: bid.bidNo,
    items: bid.items,
    departmentNameAndAddress: bid.departmentNameAndAddress,
    address: bid.address,
    bidEndDateTime: bid.bidEndDateTime,
  };
}

/**
 * The one place that turns a bid + a firm's vault into an ATC document
 * (PDF and Word) - shared by the standalone "Generate ATC" route and the
 * ZIP bundle route, so both always produce the exact same ATC rather than
 * two slightly-diverging implementations.
 *
 * The PDF is image-based when the bid's real ATC document has been fetched
 * (see app/api/gem-bids/fetch-documents - bid.bidSpecificAtc.fileKey): the
 * real document's pages are rasterized and pasted onto the firm's
 * letterhead, one letterhead page per ATC page, with sign+stamp on every
 * page. Falls back to a single-page text summary cover (just the bid's key
 * fields filled onto the letterhead) when there's no fetched ATC document
 * yet, or the fetched one failed to render for any reason - ATC generation
 * should never hard-fail just because the optional real-document step
 * hasn't happened, since GeM's ATC download is often not even a real link
 * to fetch in the first place (see fetch-documents/finish/route.ts's note).
 *
 * The Word copy is always the bid's key fields as genuinely editable text
 * (see docxEngine.ts's buildAtcTextDocx) regardless of which PDF path ran -
 * the real multi-page ATC's own pages are scans, not something that can
 * honestly become "editable" without OCR, so the Word file covers the one
 * part that's actual structured data either way.
 */
export async function buildAtcDocument(
  bid: any,
  letterheadBytes: Buffer,
  signBytes: Buffer | null,
  stampBytes: Buffer | null
): Promise<BuildAtcResult> {
  let pdfDoc: PDFDocument;
  let mode: "image" | "text_fallback" = "text_fallback";
  let note: string | undefined;
  const fields = atcFieldsFor(bid);

  const atcFileKey = bid.bidSpecificAtc?.fileKey;
  if (atcFileKey) {
    try {
      const atcBytes = await getFileFromR2(atcFileKey);
      const pageImages = await renderPdfPagesToImages(atcBytes);
      pdfDoc = await buildImageBasedAtc(letterheadBytes, pageImages, signBytes, stampBytes);
      mode = "image";
    } catch (err: any) {
      console.error("Image-based ATC generation failed, falling back to text cover:", err);
      note = `Couldn't use the fetched ATC document (${err.message || "unknown error"}) — used a text summary cover page instead.`;
      pdfDoc = await generateAtcContentPage(letterheadBytes, fields, signBytes, stampBytes);
    }
  } else {
    note =
      "No ATC document has been fetched for this bid yet — used a text summary cover page instead (not every bid has a real ATC document available on GeM).";
    pdfDoc = await generateAtcContentPage(letterheadBytes, fields, signBytes, stampBytes);
  }

  const docxBytes = await buildAtcTextDocx(fields, signBytes, stampBytes);

  return { pdfDoc, docxBytes, mode, note };
}
