import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  basePath: process.env.NEXT_PUBLIC_TOKENHUB_BASE_PATH?.trim() || "",
  // 纯静态导出：产物在 out/，由 nginx 等静态服务器直接托管，运行时不依赖 Node。
  output: "export",
  // 每个路由导出为 <route>/index.html，配合静态服务器的 try_files 使用。
  trailingSlash: true,
  images: { unoptimized: true },
  // Keep isolated UI runs independent of unrelated lockfiles above the checkout.
  turbopack: { root: process.cwd() },
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  distDir: process.env.TOKENHUB_NEXT_DIST_DIR || ".next",
};

export default nextConfig;