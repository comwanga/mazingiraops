import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { from, mergeMap, type Observable } from "rxjs";
import { DashboardCacheInvalidator } from "./dashboard-cache-invalidator.service";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const AGGREGATE_PATHS = ["/attendance", "/absence-requests", "/work-logs", "/reports", "/staff"];

@Injectable()
export class DashboardCacheInvalidationInterceptor implements NestInterceptor {
  constructor(private readonly invalidator: DashboardCacheInvalidator) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const shouldInvalidate =
      MUTATING_METHODS.has(request.method) && AGGREGATE_PATHS.some((path) => request.url.includes(path));
    if (!shouldInvalidate) return next.handle();
    return next.handle().pipe(
      mergeMap((value) => from(this.invalidator.invalidate()).pipe(mergeMap(() => [value]))),
    );
  }
}
