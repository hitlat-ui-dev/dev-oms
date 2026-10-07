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
 * The PDF is image-based when either the bid's own Bid Document or its real
 * ATC document (or both) have been fetched (see app/api/gem-bids/
 * fetch-documents - bid.bidLinkDoc.fileKey / bid.bidSpecificAtc.fileKey):
 * both documents' pages are rasterized and pasted onto the firm's
 * letterhead, one letterhead page per source page, Bid Document pages first
 * (what was actually bid on) followed by the ATC document's own pages (the
 * acceptance paperwork for it), with sign+stamp on every page. Falls back
 * to a single-page text summary cover (just the bid's key fields filled
 * onto the letterhead) when neither document has been fetched yet, or
 * both failed to render for any reason - ATC generation should never
 * hard-fail just because the optional real-document step hasn't happened,
 * since GeM's document downloads are often not even real links to fetch in
 * the first place (see fetch-documents/finish/route.ts's note).
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

  const bidLinkFileKey = bid.bidLinkDoc?.fileKey;
  const atcFileKey = bid.bidSpecificAtc?.fileKey;
  if (bidLinkFileKey || atcFileKey) {
    try {
      const pageImages: Buffer[] = [];
      const failures: string[] = [];
      if (bidLinkFileKey) {
        try {
          const bidLinkBytes = await getFileFromR2(bidLinkFileKey);
          pageImages.push(...(await renderPdfPagesToImages(bidLinkBytes)));
        } catch (err: any) {
          failures.push(`Bid Document (${err.message || "unknown error"})`);
        }
      }
      if (atcFileKey) {
        try {
          const atcBytes = await getFileFromR2(atcFileKey);
          pageImages.push(...(await renderPdfPagesToImages(atcBytes)));
        } catch (err: any) {
          failures.push(`ATC Document (${err.message || "unknown error"})`);
        }
      }
      if (pageImages.length === 0) throw new Error(failures.join("; ") || "no pages rendered");
      pdfDoc = await buildImageBasedAtc(letterheadBytes, pageImages, signBytes, stampBytes);
      mode = "image";
      if (failures.length > 0) {
        note = `Couldn't use: ${failures.join("; ")} — used the document(s) that did render.`;
      }
    } catch (err: any) {
      console.error("Image-based ATC generation failed, falling back to text cover:", err);
      note = `Couldn't use the fetched document(s) (${err.message || "unknown error"}) — used a text summary cover page instead.`;
      pdfDoc = await generateAtcContentPage(letterheadBytes, fields, signBytes, stampBytes);
    }
  } else {
    note =
      "No Bid Document or ATC document has been fetched for this bid yet — used a text summary cover page instead (not every bid has these available on GeM).";
    pdfDoc = await generateAtcContentPage(letterheadBytes, fields, signBytes, stampBytes);
  }

  const docxBytes = await buildAtcTextDocx(fields, letterheadBytes, signBytes, stampBytes);

  return { pdfDoc, docxBytes, mode, note };
}
