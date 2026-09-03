import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/v1/[...path]/route";

function context(...path: string[]) {
  return { params: Promise.resolve({ path }) };
}

describe("runtime API proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("fails explicitly when production has no API target", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("API_INTERNAL_URL", "");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");

    const response = await GET(
      new Request("https://mazingiraops.example/api/v1/auth/me"),
      context("auth", "me"),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "API_PROXY_NOT_CONFIGURED" },
    });
  });

  it("forwards the path, query, session headers, body, and API response", async () => {
    vi.stubEnv("API_INTERNAL_URL", "http://api.railway.internal:4000");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ user: { mustChangePassword: true } }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie": "ward_session=opaque; Path=/; HttpOnly; Secure; SameSite=Lax",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("https://mazingiraops.example/api/v1/auth/login?source=web", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "existing=value",
          "x-csrf-token": "csrf-token",
        },
        body: JSON.stringify({ email: "admin@example.test", password: "Temporary-123" }),
      }),
      context("auth", "login"),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [target, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(target.toString()).toBe(
      "http://api.railway.internal:4000/api/v1/auth/login?source=web",
    );
    expect(options.method).toBe("POST");
    expect((options.headers as Headers).get("cookie")).toBe("existing=value");
    expect((options.headers as Headers).get("x-csrf-token")).toBe("csrf-token");
    expect((options.headers as Headers).get("content-length")).toBe(
      String(Buffer.byteLength(JSON.stringify({ email: "admin@example.test", password: "Temporary-123" }))),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("ward_session=opaque");
    await expect(response.json()).resolves.toEqual({ user: { mustChangePassword: true } });
  });

  it("accepts a legacy target that already includes the API prefix", async () => {
    vi.stubEnv("API_INTERNAL_URL", "https://api.example.test/api/v1/");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request("https://mazingiraops.example/api/v1/organisations/public"),
      context("organisations", "public"),
    );

    expect(response.status).toBe(204);
    expect((fetchMock.mock.calls[0] as [URL])[0].toString()).toBe(
      "https://api.example.test/api/v1/organisations/public",
    );
  });
});
