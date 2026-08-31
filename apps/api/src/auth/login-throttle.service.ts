import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { RateLimitService } from "../redis/rate-limit.service";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 5000;

interface ThrottleEntry {
  count: number;
  lockedUntil: number;
  firstAttemptAt: number;
}

@Injectable()
export class LoginThrottleService {
  private readonly attempts = new Map<string, ThrottleEntry>();

  constructor(private readonly rateLimit: RateLimitService) {}

  async consume(key: string): Promise<void> {
    const distributed = await this.rateLimit.consume("login", key, MAX_ATTEMPTS, WINDOW_MS);
    if (distributed) {
      if (!distributed.allowed) this.tooManyAttempts();
      return;
    }
    this.checkInMemory(key);
    this.recordFailureInMemory(key);
  }

  private checkInMemory(key: string): void {
    const entry = this.attempts.get(key);
    if (!entry) {
      return;
    }
    if (entry.lockedUntil > Date.now()) {
      this.tooManyAttempts();
    }
    if (Date.now() - entry.firstAttemptAt > WINDOW_MS) {
      this.attempts.delete(key);
    }
  }

  private recordFailureInMemory(key: string): void {
    this.prune();
    const now = Date.now();
    const entry = this.attempts.get(key) ?? { count: 0, lockedUntil: 0, firstAttemptAt: now };
    if (entry.lockedUntil > now) {
      return;
    }
    if (now - entry.firstAttemptAt > WINDOW_MS) {
      this.attempts.set(key, { count: 1, lockedUntil: 0, firstAttemptAt: now });
      return;
    }
    entry.count += 1;
    if (entry.count >= MAX_ATTEMPTS) {
      entry.lockedUntil = now + WINDOW_MS;
    }
    this.attempts.set(key, entry);
  }

  /** Keeps the in-memory map bounded by evicting expired entries first, then oldest entries. */
  private prune(): void {
    if (this.attempts.size <= MAX_ENTRIES) return;
    const now = Date.now();
    for (const [key, entry] of this.attempts) {
      if (now - entry.firstAttemptAt > WINDOW_MS) {
        this.attempts.delete(key);
      }
    }
    while (this.attempts.size > MAX_ENTRIES) {
      const oldest = this.attempts.keys().next().value;
      if (oldest === undefined) break;
      this.attempts.delete(oldest);
    }
  }

  async recordSuccess(key: string): Promise<void> {
    this.attempts.delete(key);
    await this.rateLimit.reset("login", key);
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }

  resetAll(): void {
    this.attempts.clear();
  }

  private tooManyAttempts(): never {
    throw new HttpException(
      "Too many failed attempts. Try again later.",
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
