import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  async rewrites() {
    return {
      beforeFiles: [
        // Serve the self-contained GymLog app directly at the root (no iframe),
        // so Supabase email OTP and Google OAuth redirects work top-level.
        { source: "/", destination: "/gymlog-classic.html" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
