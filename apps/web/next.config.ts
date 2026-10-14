import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@monsoc/sdk"],
  reactStrictMode: true,
  // the project doesn't use ESLint; skip it so CI builds don't warn or fail on a missing config
  eslint: { ignoreDuringBuilds: true },
  // WebAuthn Related Origin Requests: browsers fetch https://<rpId>/.well-known/webauthn
  async rewrites() {
    return [{ source: "/.well-known/webauthn", destination: "/api/webauthn-origins" }];
  },
};

export default nextConfig;
