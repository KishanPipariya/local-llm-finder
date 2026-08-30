import type { NextConfig } from "next";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(), payment=(), usb=()" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
] as const;

const nextConfig: NextConfig = {
  cacheComponents: true,
  async headers() {
    return [{ source: "/:path*", headers: [...securityHeaders] }];
  },
  // TypeScript 7 is installed as the native CLI; Next and ESLint use the
  // official TypeScript 6 compatibility API until TypeScript 7.1 exposes one.
  experimental: { useTypeScriptCli: false },
};

export default nextConfig;
