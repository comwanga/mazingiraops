import { afterEach, describe, expect, it, vi } from "vitest";
import jsQR from "jsqr";
import {
  apiErrorMessage,
  ApiError,
  checkInPublic,
  downloadReportEvidence,
  extendAttendanceSession,
  listStaff,
  listAttendance,
  listSessions,
  listPublicOrganisations,
  listUsers,
  login,
  requestAccess,
  reviewAttendanceAbsence,
  resetUserPassword,
  setUserActive,
  updateUserAssignments,
} from "@/lib/api";
import { visibleNavigation } from "@/lib/capabilities";
import { formatUserIdentity } from "@/lib/identity";
import { SYSTEM_ADMIN_CAPABILITIES } from "@ward-ops/contracts";
import { createQrMatrix } from "@/lib/qr";
import {
  buildAttendanceSessionInput,
  resolveAttendanceWardId,
} from "@/lib/attendance-session";
import {
  EVIDENCE_MAX_PER_STAGE,
  addEvidenceFiles,
  createEvidenceFileSelection,
  evidenceUploadKey,
} from "@/lib/work-log-evidence";
import { buildAttendanceReportHref, buildDailyReportHref, readDailyReportPrefill } from "@/lib/report-navigation";

describe("capability-aware navigation", () => {
  it("only exposes modules granted to the account", () => {
    expect(visibleNavigation(["ATTENDANCE_READ", "REPORTS_READ"]).map((item) => item.href)).toEqual([
      "/dashboard",
      "/attendance",
      "/reports",
    ]);
  });

  it("shows system administrators only account administration and reports", () => {
    expect(visibleNavigation(SYSTEM_ADMIN_CAPABILITIES).map((item) => item.href)).toEqual([
      "/dashboard",
      "/access-requests",
      "/reports",
    ]);
  });
});

describe("signed-in role and scope identity", () => {
  it("identifies a Makina ward environment officer with the correct parent sub-county", () => {
    expect(formatUserIdentity({
      assignments: [{
        id: "assignment-1",
        role: "WARD_OFFICER",
        roleName: "ward officer",
        scopeType: "WARD",
        countyId: null,
        subcountyId: null,
        wardId: "ward-makina",
        countyName: null,
        subcountyName: "Kibra",
        wardName: "Makina",
      }],
    })).toBe("Ward Environment Officer · Makina Ward · Kibra Sub-County");
  });
});

describe("role-aware API errors", () => {
  it("does not expose a generic server denial to the user", () => {
    expect(apiErrorMessage(new ApiError(403, "FORBIDDEN", "Forbidden"), "Failed")).toContain(
      "does not have permission",
    );
    expect(apiErrorMessage(new ApiError(401, "UNAUTHORIZED", "Unauthorized"), "Failed")).toContain(
      "expired",
    );
  });
});

describe("API trust boundaries", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("never converts a failed sign-in request into a local session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));

    await expect(login("admin@nairobi.go.ke", "not-a-real-password")).rejects.toThrow(
      "network unavailable",
    );
  });

  it("surfaces backend unavailability instead of returning fabricated records", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () =>
          JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE", message: "Service unavailable" } }),
      }),
    );

    await expect(listStaff()).rejects.toMatchObject({
      status: 503,
      code: "SERVICE_UNAVAILABLE",
    });
  });
});

describe("attendance API filters", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends history filters to the existing endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "[]",
    });
    vi.stubGlobal("fetch", fetchMock);

    await listAttendance({ wardId: "ward 1", workDate: "2026-08-20" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/attendance?wardId=ward+1&workDate=2026-08-20",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("requests only the selected ward's latest session for the live register", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "[]" });
    vi.stubGlobal("fetch", fetchMock);

    await listSessions({ wardId: "ward-makina", workDate: "2026-08-31", pageSize: 1 });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/attendance/sessions?wardId=ward-makina&workDate=2026-08-31&pageSize=1",
      expect.objectContaining({ credentials: "include" }),
    );
  });
});

describe("attendance session setup", () => {
  const wards = [
    { id: "ward-makina", code: "MAKINA", name: "Makina", subcountyId: "kibra" },
    { id: "ward-lindi", code: "LINDI", name: "Lindi", subcountyId: "kibra" },
  ];

  it("maps the session to an accessible ward assignment even when it is not first", () => {
    expect(resolveAttendanceWardId(wards, [
      { wardId: null },
      { wardId: "ward-makina" },
    ])).toBe("ward-makina");
  });

  it("does not retain a ward outside the signed-in account's accessible wards", () => {
    expect(resolveAttendanceWardId(wards, [{ wardId: "ward-makina" }], "ward-elsewhere"))
      .toBe("ward-makina");
  });

  it("builds backward-compatible activity and location metadata without extra form fields", () => {
    expect(buildAttendanceSessionInput(wards[0], 120)).toEqual({
      wardId: "ward-makina",
      activity: "Ward attendance",
      location: "Makina Ward",
      durationMinutes: 120,
    });
  });
});

describe("work-log photo selection", () => {
  const photo = (name: string, lastModified: number) => ({ name, size: 1024, lastModified });

  it("starts every evidence stage with an independent empty selection", () => {
    expect(createEvidenceFileSelection()).toEqual({ BEFORE: [], DURING: [], AFTER: [] });
  });

  it("accepts up to four unique photos for one evidence stage", () => {
    const result = addEvidenceFiles([], Array.from(
      { length: EVIDENCE_MAX_PER_STAGE },
      (_, index) => photo(`before-${index + 1}.jpg`, index),
    ));

    expect(result.files).toHaveLength(4);
    expect(result.rejectedCount).toBe(0);
  });

  it("keeps the four-photo threshold and ignores duplicate or excess files", () => {
    const existing = [photo("before-1.jpg", 1)];
    const result = addEvidenceFiles(existing, [
      photo("before-1.jpg", 1),
      photo("before-2.jpg", 2),
      photo("before-3.jpg", 3),
      photo("before-4.jpg", 4),
      photo("before-5.jpg", 5),
    ]);

    expect(result.files.map((file) => file.name)).toEqual([
      "before-1.jpg",
      "before-2.jpg",
      "before-3.jpg",
      "before-4.jpg",
    ]);
    expect(result.rejectedCount).toBe(2);
  });

  it("uses stable stage-specific upload keys for safe retries", () => {
    const selected = photo("site.jpg", 42);
    expect(evidenceUploadKey("BEFORE", selected)).toBe(evidenceUploadKey("BEFORE", selected));
    expect(evidenceUploadKey("BEFORE", selected)).not.toBe(evidenceUploadKey("AFTER", selected));
  });
});

describe("work-log report handoff", () => {
  it("builds and validates an attendance-inclusive daily report prefill", () => {
    const href = buildDailyReportHref("ward-makina", "2026-08-31");
    const url = new URL(href, "https://mazingira.example");

    expect(url.pathname).toBe("/reports");
    expect(readDailyReportPrefill(url.search)).toEqual({
      scopeType: "WARD",
      scopeId: "ward-makina",
      startDate: "2026-08-31",
      endDate: "2026-08-31",
      kind: "DAILY",
      preview: true,
    });
  });

  it("builds a daily report prefill from a completed attendance register", () => {
    const href = buildAttendanceReportHref("ward-makina", "2026-08-31");
    const url = new URL(href, "https://mazingira.example");

    expect(url.searchParams.get("source")).toBe("attendance");
    expect(readDailyReportPrefill(url.search)).toEqual({
      scopeType: "WARD",
      scopeId: "ward-makina",
      startDate: "2026-08-31",
      endDate: "2026-08-31",
      kind: "DAILY",
      preview: true,
    });
  });

  it("ignores untrusted or malformed report prefill URLs", () => {
    expect(readDailyReportPrefill("?source=work-log&scopeType=COUNTY&scopeId=county-1&kind=DAILY&startDate=2026-08-31&endDate=2026-08-31"))
      .toBeNull();
    expect(readDailyReportPrefill("?source=work-log&scopeType=WARD&scopeId=ward-1&kind=DAILY&startDate=not-a-date&endDate=2026-08-31"))
      .toBeNull();
  });
});

describe("QR rendering", () => {
  it("creates a square QR matrix with finder patterns and a quiet-ready edge", () => {
    const matrix = createQrMatrix("https://example.test/check-in/attendance-token-123456");
    expect(matrix.length).toBeGreaterThanOrEqual(21);
    expect(matrix.every((row) => row.length === matrix.length)).toBe(true);
    expect(matrix[0].slice(0, 7)).toEqual([true, true, true, true, true, true, true]);
    expect(matrix[1].slice(0, 7)).toEqual([true, false, false, false, false, false, true]);
    expect(matrix.flat().some((module) => !module)).toBe(true);
  });

  it("decodes the generated matrix with an independent scanner", () => {
    const value = "https://example.test/check-in/attendance-token-123456";
    const matrix = createQrMatrix(value);
    const quiet = 4;
    const scale = 4;
    const width = (matrix.length + quiet * 2) * scale;
    const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
    matrix.forEach((row, y) => row.forEach((filled, x) => {
      if (!filled) return;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const offset = (((y + quiet) * scale + dy) * width + (x + quiet) * scale + dx) * 4;
          pixels[offset] = 0;
          pixels[offset + 1] = 0;
          pixels[offset + 2] = 0;
        }
      }
    }));
    expect(jsQR(pixels, width, width)?.data).toBe(value);
  });
});

describe("new backend client routes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("includes the selected organisation scope in an access request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '{"id":"request-1"}' });
    vi.stubGlobal("fetch", fetchMock);

    await requestAccess({
      displayName: "Test User",
      email: "test@example.test",
      password: "a-long-password",
      reason: "Operational review",
      requestedScope: "WARD",
      requestedScopeId: "ward-1",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/users/access-requests",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"requestedScope":"WARD"'),
      }),
    );
  });

  it("loads the sanitized public organisation directory", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '{"counties":[]}' });
    vi.stubGlobal("fetch", fetchMock);

    await expect(listPublicOrganisations()).resolves.toEqual({ counties: [] });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/organisations/public",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("uses the user lifecycle routes and assignment payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '{"users":[]}' });
    vi.stubGlobal("fetch", fetchMock);

    await listUsers();
    await updateUserAssignments("user/1", [{ roleCode: "READ_ONLY", scopeType: "WARD", scopeId: "ward-1" }]);
    await setUserActive("user/1", false);
    await setUserActive("user/1", true);
    await resetUserPassword("user/1", "temporary-password");

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/users",
      "/api/v1/users/user%2F1/assignments",
      "/api/v1/users/user%2F1/disable",
      "/api/v1/users/user%2F1/restore",
      "/api/v1/users/user%2F1/reset-password",
    ]);
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({ method: "PUT" }));
  });

  it("refuses an untrusted report evidence path before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(downloadReportEvidence("https://example.test/evidence")).rejects.toMatchObject({
      code: "INVALID_EVIDENCE_PATH",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends employee absence declarations and supervisor attendance actions", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '{"ok":true}' });
    vi.stubGlobal("fetch", fetchMock);

    await checkInPublic("session-token-123456", "20230464669", null, null, "ABSENT", "SICK_OFF");
    await extendAttendanceSession("session/1", 30);
    await reviewAttendanceAbsence("attendance/1", { action: "APPROVE", expectedVersion: 1 });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/attendance/sessions/session-token-123456/check-in",
      "/api/v1/attendance/sessions/session%2F1/extend",
      "/api/v1/attendance/attendance%2F1/absence-review",
    ]);
    expect(fetchMock.mock.calls[0][1].body).toContain('"absenceReason":"SICK_OFF"');
  });
});
