import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Server runs send the browser's capture module along with the code.
  outputFileTracingIncludes: { "/api/run": ["./public/workers/bj_capture.py"] },
  async headers() {
    return [
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      { source: "/workers/:file*", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      { source: "/vendor/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
};

export default nextConfig;
