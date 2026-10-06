import { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel, AlignmentType } from "docx";
import type { AtcBidFields } from "./pdfEngine";

/**
 * Builds the ATC's Word copy as a genuinely editable text document - same
 * content/layout as generateAtcContentPage's PDF cover (lib/documentMaker/
 * pdfEngine.ts), just as real paragraphs/headings instead of a rendered
 * image. Used for the Word download regardless of whether the PDF ATC
 * itself ended up image-based or the text-summary fallback (see
 * buildAtcDocument.ts) - the real multi-page ATC document's own pages are
 * pasted-in scans, not something that can become "editable text" without
 * OCR (which loses structure and often garbles tables), so this covers the
 * bid's own key fields: the one part that's always real structured data,
 * not a scan, and so the one part that can honestly be offered as an
 * editable Word document. Deliberately no letterhead graphic - keeping
 * this a plain document is what makes it freely re-formattable; a firm
 * wanting their own letterhead design in Word can paste this text into
 * their own template.
 */
export async function buildAtcTextDocx(
  fields: AtcBidFields,
  signBytes?: Buffer | Uint8Array | null,
  stampBytes?: Buffer | Uint8Array | null
): Promise<Buffer> {
  const rows: [string, string][] = [
    ["Bid No", fields.bidNo || "-"],
    ["Item(s)", fields.items || "-"],
    ["Department & Address", fields.departmentNameAndAddress || fields.address || "-"],
    ["Bid End Date/Time", fields.bidEndDateTime || "-"],
  ];

  const children: Paragraph[] = [
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
    sections: [{ properties: {}, children }],
  });

  return Packer.toBuffer(doc);
}
