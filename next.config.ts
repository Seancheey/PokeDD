import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  images: {
    // Pokémon sprites are keyed by dex number and never change, so cache the
    // optimized output for a year. This sets Cache-Control on /_next/image so
    // the browser loads each sprite once instead of re-requesting per page view.
    minimumCacheTTL: 31536000, // 1 year
    remotePatterns: [
      {
        protocol: "https",
        hostname: "raw.githubusercontent.com",
        pathname: "/PokeAPI/sprites/**",
      },
    ],
  },
};

export default withNextIntl(nextConfig);
