import type { NextConfig } from "next";

// Static export so the Rust rime-server can serve the built UI from one
// process — no separate Node runtime in the demo. Images are unoptimized
// (no sharp needed) and asset paths are relative for same-origin serving.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
