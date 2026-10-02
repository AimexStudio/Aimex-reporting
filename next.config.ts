import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["firebase-admin"],
  poweredByHeader: false,
  experimental: {
    serverActions: { bodySizeLimit: "25mb" }, // room for several monthly CSVs in one upload
  },
};

export default nextConfig;
