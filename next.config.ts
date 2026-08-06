import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // TypeScript 7 is installed as the native CLI; Next and ESLint use the
  // official TypeScript 6 compatibility API until TypeScript 7.1 exposes one.
  experimental: { useTypeScriptCli: false },
};

export default nextConfig;
