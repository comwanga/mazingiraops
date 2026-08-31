import { describe, expect, it, vi } from "vitest";
import { HealthService } from "../src/health/health.service";
import type { AppConfig } from "../src/config/config";

function baseConfig(): AppConfig {
  return {
    env: "test",
    port: 4000,
    databaseUrl: "postgresql://x",
    redis: { configured: false, connectTimeoutMs: 2_000, dashboardTtlSeconds: 120 },
    publicBaseUrl: "http://localhost:3000",
    sessionHours: 12,
    secureCookies: false,
    storage: {
      region: "us-east-1",
      forcePathStyle: false,
      configured: false,
    },
    ownerSetupToken: undefined,
    smtp: { port: 587, from: "x@y.z", configured: false },
    ai: { enabled: false, baseUrl: "", model: "" },
    maxUploadBytes: 1024,
    documentStoreDir: "data/objects",
  };
}

describe("HealthService", () => {
  it("reports database up and storage not_configured in development", async () => {
    const prisma = { ping: vi.fn().mockResolvedValue(undefined) } as never;
    const storage = { ping: vi.fn() } as never;
    const redis = { status: vi.fn().mockResolvedValue("not_configured") } as never;
    const service = new HealthService(prisma, storage, redis, baseConfig());
    await expect(service.ready()).resolves.toEqual({
      database: "up",
      storage: "not_configured",
      redis: "not_configured",
    });
    expect((storage as { ping: ReturnType<typeof vi.fn> }).ping).not.toHaveBeenCalled();
  });

  it("reports storage up when configured and reachable", async () => {
    const prisma = { ping: vi.fn().mockResolvedValue(undefined) } as never;
    const storage = { ping: vi.fn().mockResolvedValue(undefined) } as never;
    const config = { ...baseConfig(), storage: { ...baseConfig().storage, configured: true } };
    const redis = { status: vi.fn().mockResolvedValue("up") } as never;
    const service = new HealthService(prisma, storage, redis, config);
    await expect(service.ready()).resolves.toEqual({ database: "up", storage: "up", redis: "up" });
  });

  it("reports storage down when configured but unreachable", async () => {
    const prisma = { ping: vi.fn().mockResolvedValue(undefined) } as never;
    const storage = { ping: vi.fn().mockRejectedValue(new Error("unreachable")) } as never;
    const config = { ...baseConfig(), storage: { ...baseConfig().storage, configured: true } };
    const redis = { status: vi.fn().mockResolvedValue("down") } as never;
    const service = new HealthService(prisma, storage, redis, config);
    await expect(service.ready()).resolves.toEqual({ database: "up", storage: "down", redis: "down" });
  });

  it("reports database down on ping failure", async () => {
    const prisma = { ping: vi.fn().mockRejectedValue(new Error("no db")) } as never;
    const storage = { ping: vi.fn() } as never;
    const redis = { status: vi.fn().mockResolvedValue("not_configured") } as never;
    const service = new HealthService(prisma, storage, redis, baseConfig());
    await expect(service.ready()).resolves.toEqual({
      database: "down",
      storage: "not_configured",
      redis: "not_configured",
    });
  });

  it("reports optional Redis down without changing database or storage status", async () => {
    const prisma = { ping: vi.fn().mockResolvedValue(undefined) } as never;
    const storage = { ping: vi.fn() } as never;
    const redis = { status: vi.fn().mockResolvedValue("down") } as never;
    const service = new HealthService(prisma, storage, redis, baseConfig());
    await expect(service.ready()).resolves.toEqual({
      database: "up",
      storage: "not_configured",
      redis: "down",
    });
  });
});
