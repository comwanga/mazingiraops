import { Global, Module } from "@nestjs/common";
import { CacheService } from "./cache.service";
import { DashboardCacheInvalidator } from "./dashboard-cache-invalidator.service";
import { RateLimitService } from "./rate-limit.service";
import { RedisService } from "./redis.service";

@Global()
@Module({
  providers: [RedisService, CacheService, RateLimitService, DashboardCacheInvalidator],
  exports: [RedisService, CacheService, RateLimitService, DashboardCacheInvalidator],
})
export class RedisModule {}
