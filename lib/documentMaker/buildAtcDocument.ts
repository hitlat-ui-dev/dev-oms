import { PDFDocument } from "pdf-lib";
import { getFileFromR2 } from "@/lib/cloudflareR2";
import { generateAtcContentPage, AtcBidFields } from "./pdfEngine";
import { renderPdfPagesToImages, buildImageBasedAtc } from "./imageAtcEngine";
import { buildImagePagesDocx } from "./docxEngine";

export interface BuildAtcResult {
  pdfDoc: PDFDocument;
  docxBytes: Buffer;
  mode: "image" | "text_fallback";
  note?: string;
}

async function buildTextFallback(
  bid: any,
  letterheadBytes: Buffer,
  signBytes: Buffer | null,
  stampBytes: Buffer | null
): Promise<PDFDocument> {
  const fields: AtcBidFields = {
    bidNo: bid.bidNo,
    items: bid.items,
    departmentNameAndAddress: bid.departmentNameAndAddress,
    address: bid.address,
    bidEndDateTime: bid.bidEndDateTime,
  };
  return generateAtcContentPage(letterheadBytes, fields, signBytes, stampBytes);
}

/**
 * The one place that turns a bid + a firm's vault into an ATC document
 * (PDF and Word) - shared by the standalone "Generate ATC" route and the
 * ZIP bundle route, so both always produce the exact same ATC rather than
 * two slightly-diverging implementations.
 *
 * Image-based when the bid's real ATC document has been fetched (see
 * app/api/gem-bids/fetch-documents - bid.bidSpecificAtc.fileKey): the real
 * document's pages are rasterized and pasted onto the firm's letterhead,
 * one letterhead page per ATC page, with sign+stamp on every page. Falls
 * back to the old single-page text summary cover (just the bid's key
 * fields filled onto the letterhead) when there's no fetched ATC document
 * yet, or the fetched one failed to render for any reason - ATC generation
 * should never hard-fail just because the optional real-document step
 * hasn't happened, since GeM's ATC download is often not even a real link
 * to fetch in the first place (see fetch-documents/finish/route.ts's note).
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
      pdfDoc = await buildTextFallback(bid, letterheadBytes, signBytes, stampBytes);
    }
  } else {
    note =
      'No ATC document has been fetched for this bid yet — used a text summary cover page instead. Click "Fetch Bid Documents" first to enable the real multi-page ATC (not every bid has one available - see the note on that button).';
    pdfDoc = await buildTextFallback(bid, letterheadBytes, signBytes, stampBytes);
  }

  // Word version mirrors whatever the final PDF pages actually look like -
  // re-rasterizing the generated PDF itself (not the raw source ATC) is
  // correct for both the image-based and text-fallback path alike, since
  // the text cover is also just a PDF page by the time this runs.
  const finalBytes = Buffer.from(await pdfDoc.save());
  const finalPageImages = await renderPdfPagesToImages(finalBytes);
  const firstPage = pdfDoc.getPages()[0];
  const docxBytes = await buildImagePagesDocx(finalPageImages, {
    width: firstPage.getWidth(),
    height: firstPage.getHeight(),
  });

  return { pdfDoc, docxBytes, mode, note };
}
