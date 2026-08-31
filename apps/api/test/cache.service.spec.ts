import { beforeEach, describe, expect, it, vi } from "vitest";
import { CacheService } from "../src/redis/cache.service";
import type { RedisService } from "../src/redis/redis.service";

class FakeRedis {
  readonly values = new Map<string, { value: string; expiresAt?: number }>();
  available = true;

  private readonly client = {
    get: async (key: string) => {
      const entry = this.values.get(key);
      if (!entry) return null;
      if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
        this.values.delete(key);
        return null;
      }
      return entry.value;
    },
    set: async (
      key: string,
      value: string,
      options: { expiration?: { type: string; value: number } },
    ) => {
      const ttl = options.expiration?.type === "EX" ? options.expiration.value * 1_000 : undefined;
      this.values.set(key, { value, expiresAt: ttl === undefined ? undefined : Date.now() + ttl });
      return "OK" as const;
    },
    del: async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys];
      let deleted = 0;
      for (const key of list) deleted += this.values.delete(key) ? 1 : 0;
      return deleted;
    },
    scanIterator: ({ MATCH }: { MATCH: string }) => {
      const prefix = MATCH.slice(0, -1);
      const keys = [...this.values.keys()].filter((key) => key.startsWith(prefix));
      return (async function* () {
        if (keys.length > 0) yield keys;
      })();
    },
  };

  async run<T>(operation: (client: typeof this.client) => Promise<T>): Promise<T | undefined> {
    return this.available ? operation(this.client) : undefined;
  }
}

describe("CacheService", () => {
  let redis: FakeRedis;
  let cache: CacheService;

  beforeEach(() => {
    vi.useRealTimers();
    redis = new FakeRedis();
    cache = new CacheService(redis as unknown as RedisService);
  });

  it("sets and gets JSON using the application namespace", async () => {
    await expect(cache.set("dashboard:test", { count: 4 }, 120)).resolves.toBe(true);
    await expect(cache.get("dashboard:test")).resolves.toEqual({ count: 4 });
    expect(redis.values.has("mazingiraops:dashboard:test")).toBe(true);
  });

  it("honours TTL expiration", async () => {
    vi.useFakeTimers();
    await cache.set("dashboard:short", { count: 1 }, 1);
    await vi.advanceTimersByTimeAsync(1_001);
    await expect(cache.get("dashboard:short")).resolves.toBeUndefined();
  });

  it("fails safely when Redis is unavailable", async () => {
    redis.available = false;
    await expect(cache.get("dashboard:test")).resolves.toBeUndefined();
    await expect(cache.set("dashboard:test", { count: 1 }, 120)).resolves.toBe(false);
    await expect(cache.delete("dashboard:test")).resolves.toBe(false);
  });

  it("discards malformed or unexpected cached data", async () => {
    redis.values.set("mazingiraops:dashboard:bad-json", { value: "{" });
    redis.values.set("mazingiraops:dashboard:bad-shape", { value: JSON.stringify({ count: "four" }) });
    await expect(cache.get("dashboard:bad-json")).resolves.toBeUndefined();
    await expect(
      cache.get<{ count: number }>(
        "dashboard:bad-shape",
        (value): value is { count: number } =>
          Boolean(value) && typeof value === "object" && typeof (value as { count?: unknown }).count === "number",
      ),
    ).resolves.toBeUndefined();
    expect(redis.values.size).toBe(0);
  });

  it("invalidates all entries under a prefix without touching other namespaces", async () => {
    await cache.set("dashboard:a", { count: 1 }, 120);
    await cache.set("dashboard:b", { count: 2 }, 120);
    await cache.set("other:c", { count: 3 }, 120);
    await expect(cache.deleteByPrefix("dashboard:")).resolves.toBe(2);
    expect(redis.values.has("mazingiraops:other:c")).toBe(true);
  });
});
