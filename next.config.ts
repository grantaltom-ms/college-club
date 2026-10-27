import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // The old-bookings import takes an iCrew report of up to 4 MB through a server action (the default allows 1 MB). Vercel itself
    // caps a request at 4.5 MB, so the import's own limit sits just under that.
    serverActions: { bodySizeLimit: "5mb" },
  },
};

export default nextConfig;
