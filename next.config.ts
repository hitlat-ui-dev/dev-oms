import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  // @napi-rs/canvas ships a prebuilt native .node binary (used to rasterize
  // ATC PDF pages to images for the image-based ATC pipeline) - left out of
  // webpack's server bundle rather than bundled, so Node loads the real
  // binary from node_modules at runtime instead of a broken bundled copy.
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
  // pdfjs-dist's rendering path dynamically imports its own pdf.worker.mjs
  // at runtime (even in "fake worker" in-process mode - that file holds the
  // actual parsing/rendering code, not just a real-thread-only optimization)
  // rather than via a static import Vercel's output file tracing can see -
  // deployed without this, the function errors with "Setting up fake
  // worker failed: Cannot find module '.../pdf.worker.mjs'" the moment
  // image-based ATC generation is used, despite working fine locally where
  // the full node_modules tree is just sitting on disk regardless of
  // tracing. Explicitly forces the whole legacy build directory (worker +
  // its sourcemap) into every document-maker function's deployed bundle.
  outputFileTracingIncludes: {
    "/api/document-maker/atc": ["./node_modules/pdfjs-dist/legacy/build/**"],
    "/api/document-maker/bundle": ["./node_modules/pdfjs-dist/legacy/build/**"],
    // specEngine.ts (Specification Document parsing - see
    // /api/gem-bids/boq) dynamically imports pdfjs-dist the same way, so it
    // hits this exact same missing-worker failure without being listed
    // here too - silently, in its case, since parseSpecificationPdf
    // catches and logs rather than throwing, so a bid just came back with
    // every specification blank instead of an obvious error.
    "/api/gem-bids/boq": ["./node_modules/pdfjs-dist/legacy/build/**"],
    // autoDocLinksJob.ts (extractOrderItemLinks) hits the same missing-
    // worker failure mode - this route is what app/layout.tsx's self-
    // throttled site-visit job actually calls.
    "/api/gem-bids/auto-doc-links": ["./node_modules/pdfjs-dist/legacy/build/**"],
  },
};

export default nextConfig;
