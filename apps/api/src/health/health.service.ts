import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/config";
import { ObjectStorage } from "../storage/object-storage.service";
import { RedisService, type RedisStatus } from "../redis/redis.service";

export interface HealthCheckResult {
  database: "up" | "down";
  storage: "up" | "down" | "not_configured";
  redis: RedisStatus;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger("Health");

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorage,
    private readonly redisService: RedisService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async ready(): Promise<HealthCheckResult> {
    let database: "up" | "down" = "down";
    try {
      await this.prisma.ping();
      database = "up";
    } catch (error) {
      // Log the reason so a failing readiness probe is diagnosable from
      // deployment logs (e.g. Railway) without exposing secrets.
      this.logger.error(`Database readiness probe failed: ${String(error)}`);
      database = "down";
    }

    // Readiness reflects the live backing store. When S3 is configured
    // (mandatory in production), a real connectivity probe decides up/down;
    // development/test report "not_configured" so local health checks pass.
    let storage: "up" | "down" | "not_configured" = "not_configured";
    if (this.config.storage.configured) {
      try {
        await this.storage.ping();
        storage = "up";
      } catch (error) {
        this.logger.error(`Storage readiness probe failed: ${String(error)}`);
        storage = "down";
      }
    }

    const redis = await this.redisService.status();
    return { database, storage, redis };
  }
}
