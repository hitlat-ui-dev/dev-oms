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
};

export default nextConfig;
