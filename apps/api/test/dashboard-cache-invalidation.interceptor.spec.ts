import { firstValueFrom, of } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { DashboardCacheInvalidationInterceptor } from "../src/redis/dashboard-cache-invalidation.interceptor";

function context(method: string, url: string) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ method, url }) }),
  } as never;
}

describe("DashboardCacheInvalidationInterceptor", () => {
  it("invalidates after a successful aggregate-affecting mutation", async () => {
    const invalidator = { invalidate: vi.fn().mockResolvedValue(undefined) };
    const interceptor = new DashboardCacheInvalidationInterceptor(invalidator as never);
    const result = await firstValueFrom(
      interceptor.intercept(context("POST", "/api/v1/attendance/manual"), { handle: () => of({ id: "a1" }) }),
    );
    expect(result).toEqual({ id: "a1" });
    expect(invalidator.invalidate).toHaveBeenCalledOnce();
  });

  it("does not invalidate for reads or unrelated authentication mutations", async () => {
    const invalidator = { invalidate: vi.fn().mockResolvedValue(undefined) };
    const interceptor = new DashboardCacheInvalidationInterceptor(invalidator as never);
    await firstValueFrom(interceptor.intercept(context("GET", "/api/v1/attendance"), { handle: () => of([]) }));
    await firstValueFrom(interceptor.intercept(context("POST", "/api/v1/auth/login"), { handle: () => of({}) }));
    expect(invalidator.invalidate).not.toHaveBeenCalled();
  });
});
