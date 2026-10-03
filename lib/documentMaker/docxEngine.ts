import { Document, Packer, Paragraph, ImageRun } from "docx";

// PDF points -> docx's pixel-equivalent unit (ImageRun's transformation is
// in pixels at a 96dpi-equivalent scale internally) and -> twips (1pt = 20
// twips, the unit Document page size/margins use) - two different target
// units for the same physical page size, kept as two small converters
// rather than one shared constant so each call site stays readable.
const PT_TO_PX96 = 96 / 72;
const PT_TO_TWIP = 20;

/**
 * Builds a Word document that's a page-for-page mirror of an already-
 * rendered PDF: one full-bleed page image per page, at the same physical
 * page size (so it prints/looks identical to the PDF), no page margins.
 * Used for the ATC's Word copy - the ATC itself is image-based (the real
 * multi-page ATC document's pages pasted onto the firm's letterhead, see
 * lib/documentMaker/imageAtcEngine.ts), so a faithful Word version is this
 * same per-page image approach rather than attempting to reconstruct
 * editable text from what's fundamentally a scanned/rendered document.
 */
export async function buildImagePagesDocx(
  pageImages: Buffer[],
  pageSizePt: { width: number; height: number }
): Promise<Buffer> {
  if (pageImages.length === 0) {
    throw new Error("No page images to build a Word document from");
  }

  const widthPx = Math.round(pageSizePt.width * PT_TO_PX96);
  const heightPx = Math.round(pageSizePt.height * PT_TO_PX96);
  const widthTwip = Math.round(pageSizePt.width * PT_TO_TWIP);
  const heightTwip = Math.round(pageSizePt.height * PT_TO_TWIP);

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: widthTwip, height: heightTwip },
            margin: { top: 0, bottom: 0, left: 0, right: 0 },
          },
        },
        children: pageImages.map(
          (img) =>
            new Paragraph({
              children: [
                new ImageRun({
                  type: "png",
                  data: img,
                  transformation: { width: widthPx, height: heightPx },
                }),
              ],
            })
        ),
      },
    ],
  });

  return Packer.toBuffer(doc);
}
