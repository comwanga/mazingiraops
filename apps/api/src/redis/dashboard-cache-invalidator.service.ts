import { Injectable } from "@nestjs/common";
import { CacheService } from "./cache.service";

@Injectable()
export class DashboardCacheInvalidator {
  constructor(private readonly cache: CacheService) {}

  async invalidate(): Promise<void> {
    await this.cache.deleteByPrefix("dashboard:");
  }
}
