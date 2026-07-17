import type { NextConfig } from "next";

// The Content-Security-Policy is set per-request in proxy.ts (nonce-based
// script-src needs a fresh nonce, which static headers can't carry).
const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    remotePatterns: [
      // SoundCloud artwork/avatars are served from the sndcdn.com CDN.
      { protocol: "https", hostname: "*.sndcdn.com" },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
