import type { NextConfig } from "next";

// Content-Security-Policy, nonce-free so static pages and Next's inline scripts keep working.
// Shipped as Report-Only first: Pyodide (CDN script, wasm, micropip from PyPI), the user's JS
// (eval in a worker), Plotly / Vega / Bokeh (codegen), KaTeX, Supabase (https + wss, signed
// Storage URLs), Google sign-in and Vercel. Promote to enforcing once the browser reports are clean.
// The parts that can't break anything are enforced now (ENFORCED_CSP, X-Frame-Options, etc.).
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://*.supabase.co";
const supabaseWs = supabase.replace(/^https:/, "wss:");
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net https://cdn.plot.ly https://cdn.bokeh.org https://accounts.google.com/gsi/client https://vercel.live",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style https://cdn.jsdelivr.net",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://cdn.jsdelivr.net",
  `connect-src 'self' ${supabase} ${supabaseWs} https://cdn.jsdelivr.net https://pypi.org https://files.pythonhosted.org https://accounts.google.com/gsi/ https://vercel.live wss://ws-us3.pusher.com`,
  "frame-src https://accounts.google.com/gsi/ https://vercel.live",
  "media-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");
const ENFORCED_CSP = "frame-ancestors 'none'; object-src 'none'; base-uri 'self'";
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: ENFORCED_CSP },
  { key: "Content-Security-Policy-Report-Only", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Server runs send the browser's capture module along with the code.
  outputFileTracingIncludes: { "/api/run": ["./public/workers/bj_capture.py"] },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      { source: "/workers/:file*", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      { source: "/vendor/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
};

export default nextConfig;
