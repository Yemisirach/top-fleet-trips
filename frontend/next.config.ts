import type { NextConfig } from "next";

const backendOrigin = process.env.BACKEND_ORIGIN || (
  process.env.NODE_ENV === "production" ? "" : "http://localhost:8004"
);

if (!backendOrigin) {
  throw new Error("BACKEND_ORIGIN must be set when building the fleet frontend for production.");
}

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendOrigin}/api/:path*`,
      },
      {
        source: "/static/:path*",
        destination: `${backendOrigin}/static/:path*`,
      },
    ];
  },
};

export default nextConfig;
