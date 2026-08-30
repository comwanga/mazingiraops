const REQUEST_HEADERS = [
  "accept",
  "content-type",
  "cookie",
  "user-agent",
  "x-csrf-token",
  "x-forwarded-for",
  "x-request-id",
] as const;

const RESPONSE_HEADERS = [
  "cache-control",
  "content-disposition",
  "content-type",
  "etag",
  "last-modified",
  "location",
  "x-request-id",
] as const;

interface RouteContext {
  params: Promise<{ path?: string[] }>;
}

function apiBaseUrl(): URL {
  const configured =
    process.env.API_INTERNAL_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    (process.env.NODE_ENV === "production" ? "" : "http://127.0.0.1:4000");

  if (!configured) {
    throw new Error("API_INTERNAL_URL is not configured");
  }

  const url = new URL(configured);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("API_INTERNAL_URL must use HTTP or HTTPS");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  if (!url.pathname.endsWith("/api/v1")) {
    url.pathname = `${url.pathname}/api/v1`.replace(/\/+/g, "/");
  }
  return url;
}

function proxyError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

async function proxy(request: Request, context: RouteContext): Promise<Response> {
  let base: URL;
  try {
    base = apiBaseUrl();
  } catch {
    return proxyError(503, "API_PROXY_NOT_CONFIGURED", "The API proxy is not configured");
  }

  const { path = [] } = await context.params;
  const target = new URL(base);
  target.pathname = `${base.pathname.replace(/\/$/, "")}/${path
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
  target.search = new URL(request.url).search;

  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.body,
      cache: "no-store",
      redirect: "manual",
      // Node's fetch requires this when streaming a request body.
      duplex: request.body ? "half" : undefined,
    } as RequestInit & { duplex?: "half" });

    const responseHeaders = new Headers();
    for (const name of RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    const setCookies = (
      upstream.headers as Headers & { getSetCookie?: () => string[] }
    ).getSetCookie?.() ?? [];
    if (setCookies.length > 0) {
      for (const cookie of setCookies) responseHeaders.append("set-cookie", cookie);
    } else {
      const cookie = upstream.headers.get("set-cookie");
      if (cookie) responseHeaders.set("set-cookie", cookie);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch {
    return proxyError(502, "API_UNREACHABLE", "The API service is unreachable");
  }
}

export const dynamic = "force-dynamic";

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
