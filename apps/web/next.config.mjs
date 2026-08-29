/** @type {import('next').NextConfig} */
// Absolute API base the server proxies /api/v1/* to. Kept server-side so the
// browser only talks to the web origin (same-origin session cookie, no CORS).
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const apiOrigin = apiUrl.startsWith("/") ? "" : new URL(apiUrl).origin;
const cspConnectSrc = apiOrigin ? `'self' ${apiOrigin}` : "'self'";

const isDev = process.env.NODE_ENV !== "production";
const scriptSrc = isDev ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self' 'unsafe-inline'";

const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  transpilePackages: ["@ward-ops/contracts", "@ward-ops/validation"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(self)",
          },
          {
            key: "Content-Security-Policy",
            value:
              `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src ${scriptSrc}; connect-src ${cspConnectSrc}; form-action 'self'; frame-ancestors 'none'`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;