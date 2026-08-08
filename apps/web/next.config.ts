import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @repo/ui and @repo/types ship raw TS/TSX with no build step, so Next has to
  // transpile them alongside app code.
  transpilePackages: ["@repo/ui", "@repo/types"],
  devIndicators : false
};

export default nextConfig;
