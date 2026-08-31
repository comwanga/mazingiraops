import { Module, NestModule, MiddlewareConsumer } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { ConfigModule } from "./config/config.module";
import { PrismaModule } from "./prisma/prisma.module";
import { HealthModule } from "./health/health.module";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { AuthorizationModule } from "./authorization/authorization.module";
import { UsersModule } from "./users/users.module";
import { StaffModule } from "./staff/staff.module";
import { AttendanceModule } from "./attendance/attendance.module";
import { AbsenceModule } from "./absence/absence.module";
import { WorkLogModule } from "./work-log/work-log.module";
import { EvidenceModule } from "./evidence/evidence.module";
import { ReportModule } from "./report/report.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { RequestLoggingMiddleware } from "./common/request-logging.middleware";
import { RedisModule } from "./redis/redis.module";
import { DashboardCacheInvalidationInterceptor } from "./redis/dashboard-cache-invalidation.interceptor";

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RedisModule,
    AuditModule,
    HealthModule,
    AuthModule,
    AuthorizationModule,
    UsersModule,
    StaffModule,
    AttendanceModule,
    AbsenceModule,
    WorkLogModule,
    EvidenceModule,
    ReportModule,
    DashboardModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: DashboardCacheInvalidationInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggingMiddleware).forRoutes("*");
  }
}
