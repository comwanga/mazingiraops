import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { LoginThrottleService } from "../src/auth/login-throttle.service";

describe("LoginThrottleService", () => {
  it("uses the Redis-backed primitive when available", async () => {
    const rateLimit = {
      consume: vi.fn().mockResolvedValue({ allowed: false, count: 6, retryAfterMs: 60_000 }),
      reset: vi.fn(),
    };
    const throttle = new LoginThrottleService(rateLimit as never);
    await expect(throttle.consume("login-identity")).rejects.toBeInstanceOf(HttpException);
  });

  it("retains bounded in-memory protection when Redis is unavailable", async () => {
    const rateLimit = { consume: vi.fn().mockResolvedValue(undefined), reset: vi.fn() };
    const throttle = new LoginThrottleService(rateLimit as never);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(throttle.consume("login-identity")).resolves.toBeUndefined();
    }
    await expect(throttle.consume("login-identity")).rejects.toBeInstanceOf(HttpException);
  });

  it("clears both distributed and fallback state after successful authentication", async () => {
    const rateLimit = { consume: vi.fn().mockResolvedValue(undefined), reset: vi.fn().mockResolvedValue(undefined) };
    const throttle = new LoginThrottleService(rateLimit as never);
    await throttle.consume("login-identity");
    await throttle.recordSuccess("login-identity");
    expect(rateLimit.reset).toHaveBeenCalledWith("login", "login-identity");
    await expect(throttle.consume("login-identity")).resolves.toBeUndefined();
  });
});
