import { PDFDocument, PDFEmbeddedPage } from "pdf-lib";
import { createCanvas, DOMMatrix, ImageData, Path2D, Image } from "@napi-rs/canvas";

// ============================================================
// PDF PAGE -> IMAGE (no system binaries - Vercel-safe)
// ============================================================
//
// pdfjs-dist is ESM-only in its Node ("legacy") build, loaded via a dynamic
// import rather than a static one so this still works regardless of the
// rest of the project's module settings. @napi-rs/canvas ships prebuilt
// native binaries (unlike the plain `canvas` package, which needs a system
// Cairo install and has historically been unreliable on Vercel) - see
// next.config.ts's serverExternalPackages for why both are kept out of the
// webpack bundle entirely. pdfjs-dist's rendering path internally reaches
// for a handful of browser globals (DOMMatrix, ImageData, Path2D, Image)
// that plain Node doesn't have - @napi-rs/canvas ships drop-in
// implementations of exactly these, registered once below rather than per
// call.
function ensureCanvasPolyfills() {
  const g = globalThis as any;
  if (!g.DOMMatrix) g.DOMMatrix = DOMMatrix;
  if (!g.ImageData) g.ImageData = ImageData;
  if (!g.Path2D) g.Path2D = Path2D;
  if (!g.Image) g.Image = Image;
}

/**
 * Rasterizes every page of a PDF to a PNG buffer at roughly the given DPI
 * (PDF user space is 1/72in, so scale = dpi/72). 150 DPI is the default -
 * sharp enough to read clearly once pasted onto a letterhead page, without
 * each page image ballooning the final file size the way a 300dpi scan
 * would across a multi-page ATC document.
 */
export async function renderPdfPagesToImages(pdfBytes: Buffer | Uint8Array, dpi = 150): Promise<Buffer[]> {
  ensureCanvasPolyfills();
  // Dynamic import: pdfjs-dist's Node ("legacy") entry point is ESM-only.
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

  // pdfjs-dist rejects a Node Buffer here even though Buffer extends
  // Uint8Array (it checks the exact constructor, not instanceof) - always
  // wrap as a plain Uint8Array view over the same bytes (no copy) rather
  // than branching on instanceof, which would let a Buffer slip through.
  const data = new Uint8Array(pdfBytes.buffer, pdfBytes.byteOffset, pdfBytes.byteLength);
  const loadingTask = pdfjsLib.getDocument({
    data,
    // No GlobalWorkerOptions.workerSrc is configured - pdfjs-dist falls
    // back to running synchronously in-process ("fake worker") when no
    // worker is available, which is the standard, well-documented way to
    // use it from Node/serverless rather than spinning up a real worker
    // thread from a bundled file path (fragile in a serverless function).
    useSystemFonts: true,
  });

  const scale = dpi / 72;
  const images: Buffer[] = [];
  try {
    const pdf = await loadingTask.promise;
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      try {
        const viewport = page.getViewport({ scale });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        // @napi-rs/canvas's Canvas is a duck-typed equivalent of
        // HTMLCanvasElement (same .getContext("2d")/.width/.height surface
        // pdfjs-dist actually touches at runtime) - the cast is only to
        // satisfy its DOM-flavored type, not a real DOM object.
        await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise;
        images.push(canvas.toBuffer("image/png"));
      } finally {
        page.cleanup();
      }
    }
  } finally {
    // destroy() lives on the loading task, not the resolved PDFDocumentProxy.
    await loadingTask.destroy();
  }
  return images;
}

// ============================================================
// LETTERHEAD + PAGE IMAGE -> IMAGE-BASED ATC
// ============================================================

const PAGE_MARGIN_X = 36;
const PAGE_MARGIN_TOP = 70; // clears a typical letterhead header band
const PAGE_MARGIN_BOTTOM = 90; // clears the footer band + room for sign/stamp
const STAMP_WIDTH = 70;
const SIGN_WIDTH = 90;
const OVERLAY_GAP = 6;
const OVERLAY_MARGIN = 24;

function scaledToFit(imgWidth: number, imgHeight: number, maxWidth: number, maxHeight: number) {
  const scale = Math.min(maxWidth / imgWidth, maxHeight / imgHeight, 1);
  return { width: imgWidth * scale, height: imgHeight * scale };
}

/**
 * Builds one output page per rendered ATC page image: the firm's letterhead
 * (its first page, embedded once and redrawn as a lightweight reference on
 * every output page rather than copied N times) as the background, the ATC
 * page's image scaled to fit the content area between the letterhead's own
 * header/footer bands and centered there, and sign+stamp bottom-right on
 * every page (per spec - the real multi-page ATC document needs a signature
 * on each page, not just a single cover page the way the old text-only
 * generator worked).
 */
export async function buildImageBasedAtc(
  letterheadBytes: Buffer | Uint8Array,
  pageImages: Buffer[],
  signBytes?: Buffer | Uint8Array | null,
  stampBytes?: Buffer | Uint8Array | null
): Promise<PDFDocument> {
  if (pageImages.length === 0) {
    throw new Error("No pages were rendered from the ATC document");
  }

  const letterheadDoc = await PDFDocument.load(letterheadBytes);
  if (letterheadDoc.getPageCount() === 0) {
    throw new Error("Letterhead PDF has no pages");
  }
  const letterheadPageSize = letterheadDoc.getPages()[0].getSize();

  const outDoc = await PDFDocument.create();
  // Embedding the letterhead's own page once and drawing it as a reusable
  // reference (via page.drawPage) on every output page, rather than
  // copyPages-ing a fresh full copy of it per ATC page - keeps the merged
  // letterhead content (fonts, images) de-duplicated once in the output
  // file's object table instead of N times.
  const embeddedLetterhead: PDFEmbeddedPage = (await outDoc.embedPdf(letterheadDoc, [0]))[0];

  const signImage = signBytes ? await outDoc.embedPng(signBytes) : null;
  const stampImage = stampBytes ? await outDoc.embedPng(stampBytes) : null;

  for (const imgBytes of pageImages) {
    const page = outDoc.addPage([letterheadPageSize.width, letterheadPageSize.height]);
    page.drawPage(embeddedLetterhead, { x: 0, y: 0, width: letterheadPageSize.width, height: letterheadPageSize.height });

    const pageImg = await outDoc.embedPng(imgBytes);
    const contentWidth = letterheadPageSize.width - PAGE_MARGIN_X * 2;
    const contentHeight = letterheadPageSize.height - PAGE_MARGIN_TOP - PAGE_MARGIN_BOTTOM;
    const fitted = scaledToFit(pageImg.width, pageImg.height, contentWidth, contentHeight);
    const x = PAGE_MARGIN_X + (contentWidth - fitted.width) / 2;
    const y = PAGE_MARGIN_BOTTOM + (contentHeight - fitted.height) / 2;
    page.drawImage(pageImg, { x, y, width: fitted.width, height: fitted.height });

    let cursorX = letterheadPageSize.width - OVERLAY_MARGIN;
    if (stampImage) {
      const scale = STAMP_WIDTH / stampImage.width;
      const dims = { width: STAMP_WIDTH, height: stampImage.height * scale };
      cursorX -= dims.width;
      page.drawImage(stampImage, { x: cursorX, y: OVERLAY_MARGIN, width: dims.width, height: dims.height });
      cursorX -= OVERLAY_GAP;
    }
    if (signImage) {
      const scale = SIGN_WIDTH / signImage.width;
      const dims = { width: SIGN_WIDTH, height: signImage.height * scale };
      cursorX -= dims.width;
      page.drawImage(signImage, { x: cursorX, y: OVERLAY_MARGIN, width: dims.width, height: dims.height });
    }
  }

  return outDoc;
}
