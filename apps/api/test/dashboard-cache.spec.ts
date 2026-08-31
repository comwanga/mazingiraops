import { describe, expect, it, vi } from "vitest";
import { DashboardService } from "../src/dashboard/dashboard.service";
import type { AppConfig } from "../src/config/config";

const config = {
  redis: { configured: false, connectTimeoutMs: 2_000, dashboardTtlSeconds: 120 },
} as AppConfig;

const auth = {
  userId: "user-1",
  email: "officer@example.test",
  displayName: "Officer",
  sessionId: "session-1",
  csrfToken: "csrf",
  capabilities: ["STAFF_READ", "ATTENDANCE_READ", "ABSENCE_READ", "WORK_READ", "REPORTS_READ"],
  assignments: [],
} as never;

describe("DashboardService cache", () => {
  it("falls back to PostgreSQL and caches the authorized aggregate on a miss", async () => {
    const absenceCount = vi.fn().mockResolvedValueOnce(4).mockResolvedValueOnce(0);
    const client = {
      employee: { count: vi.fn().mockResolvedValue(1) },
      attendance: { count: vi.fn().mockResolvedValue(2) },
      attendanceSession: { count: vi.fn().mockResolvedValue(3) },
      absenceRequest: { count: absenceCount, findMany: vi.fn().mockResolvedValue([]) },
      workLog: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
      report: { count: vi.fn().mockResolvedValue(5) },
      $transaction: vi.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    const prisma = { client } as never;
    const scope = {
      accessibleWards: vi.fn().mockResolvedValue([{ id: "ward-1" }]),
      accessibleScopeIds: vi.fn().mockResolvedValue({
        wardIds: new Set(["ward-1"]),
        subcountyIds: new Set(),
        countyIds: new Set(),
      }),
    } as never;
    const cache = { get: vi.fn().mockResolvedValue(undefined), set: vi.fn().mockResolvedValue(false) } as never;
    const service = new DashboardService(prisma, scope, cache, config);

    const result = await service.get(auth);
    expect(result.metrics).toMatchObject({ activeStaff: 1, presentOrLateToday: 2, finalizedReports: 5 });
    expect(client.$transaction).toHaveBeenCalledOnce();
    expect((cache as { set: ReturnType<typeof vi.fn> }).set).toHaveBeenCalledWith(
      expect.stringMatching(/^dashboard:v1:[a-f0-9]{64}$/),
      expect.any(Object),
      120,
    );
  });

  it("returns a validated cache hit without executing aggregate queries", async () => {
    const cached = { asOf: "2026-08-31T00:00:00.000Z", workDate: "2026-08-31", metrics: {}, queue: [] };
    const prisma = { client: { $transaction: vi.fn() } } as never;
    const scope = {
      accessibleWards: vi.fn().mockResolvedValue([]),
      accessibleScopeIds: vi.fn().mockResolvedValue({ wardIds: new Set(), subcountyIds: new Set(), countyIds: new Set() }),
    } as never;
    const cache = { get: vi.fn().mockResolvedValue(cached), set: vi.fn() } as never;
    const service = new DashboardService(prisma, scope, cache, config);

    await expect(service.get(auth)).resolves.toBe(cached);
    expect((prisma as { client: { $transaction: ReturnType<typeof vi.fn> } }).client.$transaction).not.toHaveBeenCalled();
  });
});
