import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/config";

export type RedisStatus = "up" | "down" | "not_configured";

@Injectable()
export class RedisService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client?: RedisClientType;
  private lastFailureLogAt = 0;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    if (!config.redis.url) return;
    this.client = createClient({
      url: config.redis.url,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: config.redis.connectTimeoutMs,
        reconnectStrategy: (retries) => Math.min(100 * 2 ** Math.min(retries, 5), 3_000),
      },
    });
    this.client.on("error", (error) => this.logFailure("Redis client error", error));
  }

  onApplicationBootstrap(): void {
    if (!this.client || this.client.isOpen) return;
    void this.client.connect().catch((error) => this.logFailure("Redis connection failed", error));
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client?.isOpen) return;
    try {
      await this.client.close();
    } catch (error) {
      this.logFailure("Redis shutdown failed", error);
    }
  }

  get configured(): boolean {
    return this.config.redis.configured;
  }

  async run<T>(operation: (client: RedisClientType) => Promise<T>): Promise<T | undefined> {
    if (!this.client?.isReady) return undefined;
    try {
      return await operation(this.client);
    } catch (error) {
      this.logFailure("Redis operation failed", error);
      return undefined;
    }
  }

  async status(): Promise<RedisStatus> {
    if (!this.client) return "not_configured";
    if (!this.client.isReady) return "down";
    const pong = await this.run((client) => client.ping());
    return pong === "PONG" ? "up" : "down";
  }

  private logFailure(message: string, error: unknown): void {
    const now = Date.now();
    if (now - this.lastFailureLogAt < 30_000) return;
    this.lastFailureLogAt = now;
    const detail = error instanceof Error ? error.message : "unknown error";
    const redacted = detail.replace(/rediss?:\/\/[^\s]+/gi, "redis://[redacted]");
    this.logger.warn(`${message}: ${redacted}`);
  }
}
