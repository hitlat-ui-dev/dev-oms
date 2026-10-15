// ============================================================
// Specification Document -> per-item spec text + unit
// ============================================================
//
// GeM's Specification Document (a separate PDF from the Bid Document and
// BOQ Detail Document - see app/dashboard/gem-bids/document-maker/page.tsx's
// "Upload/Replace Specification Document" button) renders its item table as
// plain text glyphs, not an image - so unlike the BOQ Detail Document (an
// actual .xlsx with real columns), its "columns" only exist as consistent
// x-coordinate bands in the PDF's text layer. Reverse-engineered against a
// real downloaded sample (GEM/2026/B/8079014's 200-item, 6-page Specification
// Document): every row is Sr No | Item Title | Specification | Qty | Unit,
// in that left-to-right order, and - the part that actually took a second
// pass to get right - a wrapped (multi-line) Item Title or Specification
// cell has its Sr No digit vertically aligned to the row's BOTTOM line, not
// its top. Banding rows top-down from each Sr No's own y (the obvious first
// attempt) silently stole a wrapped row's upper lines into the row above it
// instead; the fix bands each row from (this Sr No's y) up to (the
// previous Sr No's y), i.e. backwards from how the digit itself reads on
// the page.
import { Buffer } from "buffer";

export interface SpecItem {
  srNo: string;
  itemTitle: string;
  specification: string;
  quantity: string;
  unit: string;
}

// x-coordinate column bands, in PDF points, lifted directly from the real
// sample above. GeM generates every bid's Specification Document off the
// same template, so these should hold across bids - but this is reverse-
// engineered from exactly one sample, not a published spec, so a
// differently-formatted one (a different item-table width, say) could come
// back with columns shifted or blank. parseSpecificationPdf degrades to
// returning [] rather than throwing in that case (see its try/catch) -
// callers already treat "no specification found" as a normal, silent
// no-op, same as a bid with no Specification Document uploaded at all.
const COLUMNS = {
  srNoMax: 102,
  itemTitle: [102, 262] as const,
  specification: [262, 460] as const,
  quantity: [460, 480] as const,
  unit: [480, 540] as const,
};

function ensurePdfjsCanvasPolyfills(mods: { DOMMatrix: any; ImageData: any; Path2D: any; Image: any }) {
  const g = globalThis as any;
  if (!g.DOMMatrix) g.DOMMatrix = mods.DOMMatrix;
  if (!g.ImageData) g.ImageData = mods.ImageData;
  if (!g.Path2D) g.Path2D = mods.Path2D;
  if (!g.Image) g.Image = mods.Image;
}

interface TextItem {
  str: string;
  transform: number[];
}

function parsePageRows(items: TextItem[]): SpecItem[] {
  const markers = items
    .filter((it) => it.transform[4] < COLUMNS.srNoMax && /^\d+$/.test(it.str.trim()))
    .map((it) => ({ y: it.transform[5], num: it.str.trim() }))
    .sort((a, b) => b.y - a.y);

  const col = (rowItems: TextItem[], [xMin, xMax]: readonly [number, number]) =>
    rowItems
      .filter((it) => it.transform[4] >= xMin && it.transform[4] < xMax && it.str.trim() !== "")
      .sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4])
      .map((it) => it.str.trim())
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

  const rows: SpecItem[] = [];
  for (let i = 0; i < markers.length; i++) {
    // A row's Sr No sits on its bottom-most line (see the file comment
    // above) - its band runs from just below the PREVIOUS marker's y down
    // to (inclusive of) this marker's own y, not the other way round.
    const yTop = i === 0 ? Infinity : markers[i - 1].y - 1;
    const yBottom = markers[i].y - 1;
    const rowItems = items.filter((it) => it.transform[5] < yTop && it.transform[5] >= yBottom);
    rows.push({
      srNo: markers[i].num,
      itemTitle: col(rowItems, COLUMNS.itemTitle),
      specification: col(rowItems, COLUMNS.specification),
      quantity: col(rowItems, COLUMNS.quantity),
      unit: col(rowItems, COLUMNS.unit),
    });
  }
  return rows;
}

/**
 * Parses a fetched Specification Document into its per-item rows, keyed by
 * srNo (matches a BOQ Detail Document's Item Number 1:1 - both come off
 * the same GeM item list in the same order). Returns [] (never throws) on
 * anything unexpected - a layout pdfjs-dist can't read, or one that just
 * doesn't look like this table - so a caller can always treat "nothing
 * usable in this file" as a plain no-op rather than a hard failure.
 */
export async function parseSpecificationPdf(buffer: Buffer | Uint8Array): Promise<SpecItem[]> {
  try {
    const canvasMods = await import("@napi-rs/canvas");
    ensurePdfjsCanvasPolyfills(canvasMods);
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

    const data =
      buffer instanceof Buffer
        ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        : new Uint8Array(buffer);
    const loadingTask = pdfjsLib.getDocument({ data, useSystemFonts: true });
    try {
      const doc = await loadingTask.promise;
      const allRows: SpecItem[] = [];
      for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
        const page = await doc.getPage(pageNum);
        try {
          const content = await page.getTextContent();
          allRows.push(...parsePageRows(content.items as TextItem[]));
        } finally {
          page.cleanup();
        }
      }
      return allRows;
    } finally {
      await loadingTask.destroy();
    }
  } catch (err) {
    console.error("Specification Document parse failed:", err);
    return [];
  }
}
