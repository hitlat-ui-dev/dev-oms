import { PDFDocument, StandardFonts } from "pdf-lib";

// ============================================================
// SIGN + STAMP OVERLAY
// ============================================================

const OVERLAY_MARGIN = 24;
const STAMP_WIDTH = 70;
const SIGN_WIDTH = 90;
const OVERLAY_GAP = 6;

/**
 * Draws the firm's sign + stamp PNGs bottom-right on every existing page of
 * pdfDoc (stamp closest to the corner, sign just to its left, both bottom-
 * aligned). Either image may be omitted (e.g. a firm hasn't uploaded a stamp
 * yet) — that side is simply skipped rather than erroring.
 */
export async function overlaySignStamp(
  pdfDoc: PDFDocument,
  signBytes?: Buffer | Uint8Array | null,
  stampBytes?: Buffer | Uint8Array | null
): Promise<void> {
  const signImage = signBytes ? await pdfDoc.embedPng(signBytes) : null;
  const stampImage = stampBytes ? await pdfDoc.embedPng(stampBytes) : null;
  if (!signImage && !stampImage) return;

  const signDims = signImage ? scaledDims(signImage.width, signImage.height, SIGN_WIDTH) : null;
  const stampDims = stampImage ? scaledDims(stampImage.width, stampImage.height, STAMP_WIDTH) : null;

  for (const page of pdfDoc.getPages()) {
    const { width: pageWidth } = page.getSize();
    let cursorX = pageWidth - OVERLAY_MARGIN;

    if (stampImage && stampDims) {
      cursorX -= stampDims.width;
      page.drawImage(stampImage, { x: cursorX, y: OVERLAY_MARGIN, width: stampDims.width, height: stampDims.height });
      cursorX -= OVERLAY_GAP;
    }
    if (signImage && signDims) {
      cursorX -= signDims.width;
      page.drawImage(signImage, { x: cursorX, y: OVERLAY_MARGIN, width: signDims.width, height: signDims.height });
    }
  }
}

function scaledDims(width: number, height: number, targetWidth: number) {
  const scale = targetWidth / width;
  return { width: targetWidth, height: height * scale };
}

// ============================================================
// MERGE
// ============================================================

/** Loads each buffer as a PDF and copies all of its pages into one merged PDFDocument. */
export async function mergePdfs(buffers: (Buffer | Uint8Array)[]): Promise<PDFDocument> {
  const merged = await PDFDocument.create();
  for (const buf of buffers) {
    const src = await PDFDocument.load(buf);
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }
  return merged;
}

// ============================================================
// SPLIT BY SIZE + PAGE COUNT
// ============================================================

const DEFAULT_MAX_PAGES = 99;
const DEFAULT_MAX_BYTES = Math.floor(9.98 * 1024 * 1024);

async function buildChunkFromIndices(pdfDoc: PDFDocument, indices: number[]): Promise<Buffer> {
  const chunk = await PDFDocument.create();
  const pages = await chunk.copyPages(pdfDoc, indices);
  pages.forEach((p) => chunk.addPage(p));
  return Buffer.from(await chunk.save());
}

/**
 * Splits pdfDoc into one or more output buffers, each respecting both a max
 * page count and a max byte size. Every candidate chunk is rebuilt fresh from
 * pdfDoc via copyPages and measured — pdf-lib's removePage() does NOT purge
 * the detached page's content-stream object from the file on save(), so
 * "add a page, measure, then remove it if too big" silently keeps the bytes
 * in the output; rebuilding from scratch is what actually shrinks it back
 * down. The chunk is re-measured after every single page (not just once every
 * 99 pages), so a chunk that's still well under the page cap but hit the byte
 * cap early (image-heavy pages) still gets closed off in time.
 */
export async function splitBySizeAndPages(
  pdfDoc: PDFDocument,
  opts: { maxPages?: number; maxBytes?: number } = {}
): Promise<Buffer[]> {
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const totalPages = pdfDoc.getPageCount();
  if (totalPages === 0) return [];

  const chunks: Buffer[] = [];
  let currentIndices: number[] = [];

  for (let i = 0; i < totalPages; i++) {
    const tentativeIndices = [...currentIndices, i];
    const tentativeBytes = await buildChunkFromIndices(pdfDoc, tentativeIndices);
    const overLimit = tentativeIndices.length > maxPages || tentativeBytes.length > maxBytes;

    if (!overLimit) {
      currentIndices = tentativeIndices;
      continue;
    }

    if (currentIndices.length > 0) {
      // This page is what pushed the chunk over a limit — close the chunk as
      // it stood before this page, then start a new chunk with just this page.
      chunks.push(await buildChunkFromIndices(pdfDoc, currentIndices));
      const soloBytes = await buildChunkFromIndices(pdfDoc, [i]);
      if (soloBytes.length > maxBytes) {
        // The page is oversized even alone — nothing left to trim.
        chunks.push(soloBytes);
        currentIndices = [];
      } else {
        currentIndices = [i];
      }
    } else {
      // A single page alone already exceeds a limit — nothing left to trim;
      // it becomes its own (oversized) chunk rather than looping forever.
      chunks.push(tentativeBytes);
      currentIndices = [];
    }
  }

  if (currentIndices.length > 0) {
    chunks.push(await buildChunkFromIndices(pdfDoc, currentIndices));
  }

  return chunks;
}

/**
 * Names each split output. A single part keeps baseName unchanged. Multiple
 * parts get `_part1`, `_part2`, ... — except once there are 10 or more parts,
 * every part number (including 1-9) is zero-padded (`_part01`, `_part02`, ...)
 * so filenames still sort correctly.
 */
export function finalizeOutputNames(baseName: string, count: number): string[] {
  if (count <= 1) return [baseName];

  const dotIndex = baseName.lastIndexOf(".");
  const stem = dotIndex >= 0 ? baseName.slice(0, dotIndex) : baseName;
  const ext = dotIndex >= 0 ? baseName.slice(dotIndex) : "";

  const width = count >= 10 ? String(count).length : 0;
  return Array.from({ length: count }, (_, i) => {
    const partNum = i + 1;
    const padded = width > 0 ? String(partNum).padStart(width, "0") : String(partNum);
    return `${stem}_part${padded}${ext}`;
  });
}

// ============================================================
// ATC CONTENT GENERATION
// ============================================================

export interface AtcBidFields {
  bidNo?: string;
  items?: string;
  departmentNameAndAddress?: string;
  address?: string;
  startDate?: string;
  bidEndDateTime?: string;
  emdAmount?: string;
  beneficiary?: string;
}

/**
 * Draws the bid's key fields onto the first page of the firm's letterhead PDF
 * as the ATC cover. The coordinates below are a placeholder default layout —
 * pending the real letterhead sample PDF, after which exact positions should
 * be tuned to sit cleanly around its printed header/logo/footer design.
 */
export async function generateAtcContentPage(
  letterheadBytes: Buffer | Uint8Array,
  fields: AtcBidFields
): Promise<PDFDocument> {
  const pdfDoc = await PDFDocument.load(letterheadBytes);
  if (pdfDoc.getPageCount() === 0) {
    throw new Error("Letterhead PDF has no pages");
  }
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page = pdfDoc.getPages()[0];
  const { width, height } = page.getSize();

  const rows: [string, string][] = [
    ["Bid No", fields.bidNo || "-"],
    ["Item(s)", fields.items || "-"],
    ["Department & Address", fields.departmentNameAndAddress || fields.address || "-"],
    ["Start Date", fields.startDate || "-"],
    ["Bid End Date/Time", fields.bidEndDateTime || "-"],
    ["EMD Amount", fields.emdAmount || "-"],
    ["Beneficiary", fields.beneficiary || "-"],
  ];

  const marginX = 50;
  const labelColumnWidth = 160;
  const lineHeight = 22;
  let y = height - height / 3;

  page.drawText("ACCEPTANCE OF TERMS & CONDITIONS", { x: marginX, y, size: 14, font: boldFont });
  y -= lineHeight * 1.5;

  for (const [label, value] of rows) {
    page.drawText(`${label}:`, { x: marginX, y, size: 10, font: boldFont });
    page.drawText(String(value), {
      x: marginX + labelColumnWidth,
      y,
      size: 10,
      font,
      maxWidth: width - marginX - labelColumnWidth - 40,
    });
    y -= lineHeight;
  }

  return pdfDoc;
}
