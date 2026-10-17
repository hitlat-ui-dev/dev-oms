// ============================================================
// Bid Document -> embedded Specification/BOQ Detail Document links
// ============================================================
//
// A multi-item ("Schedule 1..N") Bid Document PDF embeds a per-schedule
// table of "Specification Document" / "BOQ Detail Document" rows, each a
// real clickable link (View File) pointing at a file on mkp.gem.gov.in -
// see app/dashboard/gem-bids/document-maker/page.tsx's own upload buttons
// for what these two documents already are once a seller finds and
// uploads them by hand. Confirmed against a real sample (GEM/2026/B/
// 8061682's Bid Document, 23 pages): every schedule's pair of links is
// IDENTICAL across the whole bid (one shared BOQ file covering every
// item), so there's no need to resolve a per-item mapping - just find the
// first of each kind anywhere in the PDF.
//
// pdfjs-dist's page.getAnnotations() reads these directly off the PDF's
// own /Annots link objects - real structured data, not the brittle
// "flatten to text, look for a marker" approach this project's own ATC-
// field extraction (lib/pdf-extract.js, browser extension) has to fall
// back to for the GeM portal's OWN interactive form fields. A Bid
// Document's annotations are plain top-level PDF objects (not inside a
// compressed object stream), so this reads cleanly with no reconstruction
// needed.
import { Buffer } from "buffer";

export interface OrderItemLinks {
  specificationUrl: string;
  boqUrl: string;
}

const SPEC_URL_RE = /\/OrderItem\/BoqDocument\//i;
const BOQ_URL_RE = /\/OrderItem\/BoqLineItemsDocument\//i;

function ensurePdfjsCanvasPolyfills(mods: { DOMMatrix: any; ImageData: any; Path2D: any; Image: any }) {
  const g = globalThis as any;
  if (!g.DOMMatrix) g.DOMMatrix = mods.DOMMatrix;
  if (!g.ImageData) g.ImageData = mods.ImageData;
  if (!g.Path2D) g.Path2D = mods.Path2D;
  if (!g.Image) g.Image = mods.Image;
}

/**
 * Scans every page of a Bid Document PDF for its embedded Specification/BOQ
 * Detail Document links. Returns empty strings (never throws) for a bid
 * with no such table at all - a "regular" bid built straight off a catalog
 * Item Link, which never had one to begin with - same no-op-on-failure
 * contract as specEngine.ts's parseSpecificationPdf.
 */
export async function extractOrderItemLinks(buffer: Buffer | Uint8Array): Promise<OrderItemLinks> {
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
      let specificationUrl = "";
      let boqUrl = "";
      for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
        if (specificationUrl && boqUrl) break; // found both already - no need to keep scanning
        const page = await doc.getPage(pageNum);
        try {
          const annots = await page.getAnnotations();
          for (const a of annots) {
            if (a.subtype !== "Link" || !a.url) continue;
            if (!specificationUrl && SPEC_URL_RE.test(a.url)) specificationUrl = a.url;
            else if (!boqUrl && BOQ_URL_RE.test(a.url)) boqUrl = a.url;
          }
        } finally {
          page.cleanup();
        }
      }
      return { specificationUrl, boqUrl };
    } finally {
      await loadingTask.destroy();
    }
  } catch (err) {
    console.error("Bid Document link extraction failed:", err);
    return { specificationUrl: "", boqUrl: "" };
  }
}
