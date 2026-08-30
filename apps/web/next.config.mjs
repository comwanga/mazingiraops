import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== "production";
const scriptSrc = isDev ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self' 'unsafe-inline'";
const productionOnlyHeaders = isDev
  ? []
  : [
      {
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains",
      },
    ];
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: workspaceRoot,
  transpilePackages: ["@ward-ops/contracts", "@ward-ops/validation"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(self)",
          },
          {
            key: "Content-Security-Policy",
            value:
              `default-src 'self'; base-uri 'self'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src ${scriptSrc}; connect-src 'self'; form-action 'self'; frame-ancestors 'none'`,
          },
          ...productionOnlyHeaders,
        ],
      },
    ];
  },
};

export default nextConfig;
