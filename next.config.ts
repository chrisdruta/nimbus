import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // SoundCloud artwork/avatars are served from the sndcdn.com CDN.
      { protocol: "https", hostname: "*.sndcdn.com" },
    ],
  },
};

export default nextConfig;
