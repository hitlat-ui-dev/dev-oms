import { Document, Packer, Paragraph, ImageRun } from "docx";

// PDF points -> docx's pixel-equivalent unit (ImageRun's transformation is
// in pixels at a 96dpi-equivalent scale internally) and -> twips (1pt = 20
// twips, the unit Document page size/margins use) - two different target
// units for the same physical page size, kept as two small converters
// rather than one shared constant so each call site stays readable.
const PT_TO_PX96 = 96 / 72;
const PT_TO_TWIP = 20;

// A standard 0.5in margin on every side (matches docx's own PageMargin
// defaults for header/footer distance, see node_modules/docx's
// PageMarginDefault). The first version of this used 0 margins to get a
// true full-bleed page-for-page mirror of the PDF, which turned out to
// produce a .docx Word couldn't open - Word enforces a printer-driver
// minimum margin on open in some installations, and 0 fell under it on at
// least one. A normal margin with the image scaled to fit inside it (same
// "fit, don't stretch" approach as the PDF's own content-area placement in
// imageAtcEngine.ts) is the safe, broadly-compatible choice.
const MARGIN_TWIP = 720;

function scaledToFit(imgWidthPx: number, imgHeightPx: number, maxWidthPx: number, maxHeightPx: number) {
  const scale = Math.min(maxWidthPx / imgWidthPx, maxHeightPx / imgHeightPx, 1);
  return { width: Math.round(imgWidthPx * scale), height: Math.round(imgHeightPx * scale) };
}

/**
 * Builds a Word document that's a page-for-page mirror of an already-
 * rendered PDF: one page image per page, scaled to fit inside a standard
 * margin at the same physical page size (so it looks the same as the PDF,
 * just not full-bleed to the paper edge). Used for the ATC's Word copy -
 * the ATC itself is image-based (the real multi-page ATC document's pages
 * pasted onto the firm's letterhead, see lib/documentMaker/imageAtcEngine.ts),
 * so a faithful Word version is this same per-page image approach rather
 * than attempting to reconstruct editable text from what's fundamentally a
 * scanned/rendered document.
 */
export async function buildImagePagesDocx(
  pageImages: Buffer[],
  pageSizePt: { width: number; height: number }
): Promise<Buffer> {
  if (pageImages.length === 0) {
    throw new Error("No page images to build a Word document from");
  }

  const pageWidthPx = Math.round(pageSizePt.width * PT_TO_PX96);
  const pageHeightPx = Math.round(pageSizePt.height * PT_TO_PX96);
  const marginPx = Math.round((MARGIN_TWIP / 20) * PT_TO_PX96);
  const contentWidthPx = pageWidthPx - marginPx * 2;
  const contentHeightPx = pageHeightPx - marginPx * 2;

  const widthTwip = Math.round(pageSizePt.width * PT_TO_TWIP);
  const heightTwip = Math.round(pageSizePt.height * PT_TO_TWIP);

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: widthTwip, height: heightTwip },
            margin: {
              top: MARGIN_TWIP,
              bottom: MARGIN_TWIP,
              left: MARGIN_TWIP,
              right: MARGIN_TWIP,
              header: MARGIN_TWIP,
              footer: MARGIN_TWIP,
            },
          },
        },
        children: pageImages.map((img) => {
          const fitted = scaledToFit(pageWidthPx, pageHeightPx, contentWidthPx, contentHeightPx);
          return new Paragraph({
            children: [
              new ImageRun({
                type: "png",
                data: img,
                transformation: { width: fitted.width, height: fitted.height },
              }),
            ],
          });
        }),
      },
    ],
  });

  return Packer.toBuffer(doc);
}
