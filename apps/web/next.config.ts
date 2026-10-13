import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@monsoc/sdk"],
  reactStrictMode: true,
};

export default nextConfig;
