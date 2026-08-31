import { Injectable, Logger } from "@nestjs/common";
import { RedisService } from "./redis.service";

const ROOT_NAMESPACE = "mazingiraops";

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(private readonly redis: RedisService) {}

  async get<T>(key: string, validate?: (value: unknown) => value is T): Promise<T | undefined> {
    const namespaced = this.key(key);
    const raw = await this.redis.run((client) => client.get(namespaced));
    if (raw === undefined || raw === null) return undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (validate && !validate(parsed)) {
        this.logger.warn(`Discarded invalid cached value for ${this.safeKey(key)}`);
        await this.delete(key);
        return undefined;
      }
      return parsed as T;
    } catch {
      this.logger.warn(`Discarded malformed cached JSON for ${this.safeKey(key)}`);
      await this.delete(key);
      return undefined;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) return false;
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(value);
    } catch {
      this.logger.warn(`Skipped non-serializable cache value for ${this.safeKey(key)}`);
      return false;
    }
    if (serialized === undefined) return false;
    const result = await this.redis.run((client) =>
      client.set(this.key(key), serialized, { expiration: { type: "EX", value: ttlSeconds } }),
    );
    return result === "OK";
  }

  async delete(key: string): Promise<boolean> {
    const deleted = await this.redis.run((client) => client.del(this.key(key)));
    return typeof deleted === "number" && deleted > 0;
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    const deleted = await this.redis.run(async (client) => {
      let count = 0;
      for await (const keys of client.scanIterator({ MATCH: `${this.key(prefix)}*`, COUNT: 100 })) {
        if (keys.length === 0) continue;
        count += await client.del(keys);
      }
      return count;
    });
    return deleted ?? 0;
  }

  private key(key: string): string {
    return `${ROOT_NAMESPACE}:${key}`;
  }

  private safeKey(key: string): string {
    return key.replace(/:[^:]{24,}$/g, ":[redacted]");
  }
}
