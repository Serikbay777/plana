import type { NextConfig } from "next";

function normalizeEngineUrl(value: string | undefined): string | null {
  if (!value || value.startsWith("/")) return null;
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

const engineUrl = normalizeEngineUrl(process.env.ENGINE_URL);

const nextConfig: NextConfig = {
  async rewrites() {
    if (!engineUrl) return [];

    return {
      beforeFiles: [
        {
          source: "/api/:path*",
          destination: `${engineUrl}/:path*`,
        },
      ],
    };
  },
};

export default nextConfig;
