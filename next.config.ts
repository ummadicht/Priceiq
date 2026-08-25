import type { NextConfig } from "next";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
};
export default nextConfig;
