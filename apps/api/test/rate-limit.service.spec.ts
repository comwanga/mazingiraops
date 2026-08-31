import { describe, expect, it, vi } from "vitest";
import { RateLimitService } from "../src/redis/rate-limit.service";
import type { RedisService } from "../src/redis/redis.service";

describe("RateLimitService", () => {
  it("uses an atomic fixed window and hashes the identifier in the Redis key", async () => {
    let observedKey = "";
    let count = 0;
    const client = {
      eval: vi.fn(async (_script, options: { keys: string[] }) => {
        observedKey = options.keys[0] ?? "";
        count += 1;
        return [count, 60_000];
      }),
      del: vi.fn().mockResolvedValue(1),
    };
    const redis = { run: <T>(operation: (value: typeof client) => Promise<T>) => operation(client) };
    const limiter = new RateLimitService(redis as unknown as RedisService);

    await expect(limiter.consume("login", "person@example.test|127.0.0.1", 2, 60_000)).resolves.toMatchObject({
      allowed: true,
      count: 1,
    });
    await limiter.consume("login", "person@example.test|127.0.0.1", 2, 60_000);
    await expect(limiter.consume("login", "person@example.test|127.0.0.1", 2, 60_000)).resolves.toMatchObject({
      allowed: false,
      count: 3,
    });
    expect(observedKey).toMatch(/^mazingiraops:ratelimit:login:[a-f0-9]{64}$/);
    expect(observedKey).not.toContain("person@example.test");
  });

  it("returns undefined when Redis is unavailable so callers can fall back", async () => {
    const redis = { run: vi.fn().mockResolvedValue(undefined) };
    const limiter = new RateLimitService(redis as unknown as RedisService);
    await expect(limiter.consume("login", "identifier", 5, 60_000)).resolves.toBeUndefined();
  });
});
