import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8004/api/:path*",
      },
      {
        source: "/static/:path*",
        destination: "http://localhost:8004/static/:path*",
      },
    ];
  },
};

export default nextConfig;
