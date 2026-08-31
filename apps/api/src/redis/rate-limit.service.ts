import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { RedisService } from "./redis.service";

const FIXED_WINDOW_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { current, ttl }
`;

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  retryAfterMs: number;
}

@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  async consume(
    scope: string,
    identifier: string,
    limit: number,
    windowMs: number,
  ): Promise<RateLimitResult | undefined> {
    if (!Number.isInteger(limit) || limit <= 0 || !Number.isInteger(windowMs) || windowMs <= 0) {
      throw new RangeError("Rate-limit values must be positive integers");
    }
    const safeScope = scope.replace(/[^a-z0-9_-]/gi, "_");
    const digest = createHash("sha256").update(identifier).digest("hex");
    const result = await this.redis.run((client) =>
      client.eval(FIXED_WINDOW_SCRIPT, {
        keys: [`mazingiraops:ratelimit:${safeScope}:${digest}`],
        arguments: [String(windowMs)],
      }),
    );
    if (!Array.isArray(result) || result.length !== 2) return undefined;
    const count = Number(result[0]);
    const ttl = Math.max(0, Number(result[1]));
    if (!Number.isFinite(count) || !Number.isFinite(ttl)) return undefined;
    return { allowed: count <= limit, count, retryAfterMs: ttl };
  }

  async reset(scope: string, identifier: string): Promise<void> {
    const safeScope = scope.replace(/[^a-z0-9_-]/gi, "_");
    const digest = createHash("sha256").update(identifier).digest("hex");
    await this.redis.run((client) => client.del(`mazingiraops:ratelimit:${safeScope}:${digest}`));
  }
}
