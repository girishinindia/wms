import type { NextConfig } from "next";

/**
 * Security headers.
 *
 * CSP is intentionally left out at this stage — it needs to be written
 * against the real set of third parties (Bunny CDN, Sentry, Better Auth
 * Infra, reCAPTCHA) once those are wired in. A permissive one now would
 * only give false comfort. Add it in Phase 1 with a nonce, and run it in
 * report-only mode first.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(self), payment=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,

  // Warehouse photos come off Bunny once uploads are wired up.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.geniusitens.com" },
      { protocol: "https", hostname: "**.b-cdn.net" },
    ],
  },

  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // Monitors must never see a cached 200.
        source: "/api/health",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
