// Plain JavaScript so the server starts instantly (a TypeScript config is compiled at every start).
/** @type {import("next").NextConfig} */
const nextConfig = {
  serverExternalPackages: ["firebase-admin", "unpdf"],
  poweredByHeader: false,
  experimental: {
    serverActions: { bodySizeLimit: "25mb" }, // room for several CSVs or a PDF in one upload
  },
};

export default nextConfig;
