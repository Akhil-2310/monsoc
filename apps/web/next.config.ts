import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@monsoc/sdk"],
  reactStrictMode: true,
  // the project doesn't use ESLint; skip it so CI builds don't warn or fail on a missing config
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
