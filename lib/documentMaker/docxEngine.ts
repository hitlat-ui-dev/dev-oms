import { PDFDocument } from "pdf-lib";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  HeadingLevel,
  AlignmentType,
  TextWrappingType,
  HorizontalPositionAlign,
  HorizontalPositionRelativeFrom,
  VerticalPositionAlign,
  VerticalPositionRelativeFrom,
} from "docx";
import type { AtcBidFields } from "./pdfEngine";
import { renderPdfPagesToImages } from "./imageAtcEngine";

// docx's ImageRun sizes are page-placement sizes at a fixed 96px/inch,
// independent of the source bitmap's own resolution (that only affects
// sharpness) - converting the letterhead's real page size (in PDF points,
// 72pt/inch) through inches gets the displayed size to exactly match the
// physical page, same as embedding the real PDF page directly does on the
// PDF side (see pdfEngine.ts's generateAtcContentPage).
const PT_TO_PX96 = 96 / 72;
const PT_TO_TWIP = 20; // 1 point = 1/72in = 20 twips (1440 twips/in ÷ 72)

/**
 * Builds the ATC's Word copy as a genuinely editable text document - same
 * content/layout as generateAtcContentPage's PDF cover (lib/documentMaker/
 * pdfEngine.ts), just as real paragraphs/headings instead of a rendered
 * image, over the firm's actual letterhead graphic as a page-background
 * image (rasterized once from its own first page, then placed as a
 * floating "behind document" picture sized and positioned to exactly cover
 * the page - the same trick the PDF content page gets for free by using
 * the real letterhead PDF page directly, which Word documents have no
 * equivalent of). Used for the Word download regardless of whether the PDF
 * ATC itself ended up image-based or the text-summary fallback (see
 * buildAtcDocument.ts) - the real multi-page ATC document's own pages are
 * pasted-in scans, not something that can become "editable text" without
 * OCR (which loses structure and often garbles tables), so this covers the
 * bid's own key fields: the one part that's always real structured data,
 * not a scan, and so the one part that can honestly be offered as an
 * editable Word document. The page content itself (every TextRun/Paragraph
 * below) stays genuinely editable text - only the letterhead graphic is a
 * picture, exactly as it is on paper.
 */
export async function buildAtcTextDocx(
  fields: AtcBidFields,
  letterheadBytes: Buffer | Uint8Array,
  signBytes?: Buffer | Uint8Array | null,
  stampBytes?: Buffer | Uint8Array | null
): Promise<Buffer> {
  const letterheadDoc = await PDFDocument.load(letterheadBytes);
  if (letterheadDoc.getPageCount() === 0) {
    throw new Error("Letterhead PDF has no pages");
  }
  const { width: pageWidthPt, height: pageHeightPt } = letterheadDoc.getPages()[0].getSize();
  const [letterheadPng] = await renderPdfPagesToImages(letterheadBytes);

  const pageWidthTwip = Math.round(pageWidthPt * PT_TO_TWIP);
  const pageHeightTwip = Math.round(pageHeightPt * PT_TO_TWIP);
  // Text starts a third of the way down the page, same as the PDF cover's
  // own layout - clears a typical letterhead header/logo band.
  const marginTopTwip = Math.round((pageHeightPt / 3) * PT_TO_TWIP);
  const marginBottomTwip = Math.round(90 * PT_TO_TWIP); // room for sign/stamp
  const marginSideTwip = Math.round(50 * PT_TO_TWIP);

  const rows: [string, string][] = [
    ["Bid No", fields.bidNo || "-"],
    ["Item(s)", fields.items || "-"],
    ["Department & Address", fields.departmentNameAndAddress || fields.address || "-"],
    ["Bid End Date/Time", fields.bidEndDateTime || "-"],
  ];

  const letterheadRun = new ImageRun({
    type: "png",
    data: letterheadPng,
    transformation: {
      width: Math.round(pageWidthPt * PT_TO_PX96),
      height: Math.round(pageHeightPt * PT_TO_PX96),
    },
    floating: {
      horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, align: HorizontalPositionAlign.CENTER },
      verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, align: VerticalPositionAlign.TOP },
      behindDocument: true,
      wrap: { type: TextWrappingType.NONE },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    },
  });

  const children: Paragraph[] = [
    new Paragraph({ children: [letterheadRun] }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: "ACCEPTANCE OF TERMS & CONDITIONS", bold: true })],
      spacing: { after: 300 },
    }),
    ...rows.map(
      ([label, value]) =>
        new Paragraph({
          spacing: { after: 120 },
          children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun({ text: value })],
        })
    ),
    new Paragraph({ text: "", spacing: { after: 200 } }),
    new Paragraph({
      spacing: { after: 300 },
      children: [new TextRun("As per your requirement we accept your term and conditions of your bid.")],
    }),
    new Paragraph({ children: [new TextRun("Your Faithfully,")], spacing: { after: 200 } }),
  ];

  const imageRuns: ImageRun[] = [];
  if (signBytes) {
    imageRuns.push(new ImageRun({ type: "png", data: signBytes, transformation: { width: 120, height: 48 } }));
  }
  if (stampBytes) {
    imageRuns.push(new ImageRun({ type: "png", data: stampBytes, transformation: { width: 90, height: 90 } }));
  }
  if (imageRuns.length > 0) {
    children.push(new Paragraph({ children: imageRuns, alignment: AlignmentType.LEFT }));
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: pageWidthTwip, height: pageHeightTwip },
            margin: { top: marginTopTwip, bottom: marginBottomTwip, left: marginSideTwip, right: marginSideTwip },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
