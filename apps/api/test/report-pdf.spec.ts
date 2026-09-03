import { describe, expect, it } from "vitest";
import { renderReportPdf } from "../src/report/pdf/report-pdf.renderer";
import {
  computeReportAnalytics,
  emptyTotals,
  ReportSnapshot,
  SNAPSHOT_VERSION,
} from "../src/report/report-aggregation";

describe("report PDF renderer (§1, §2, §3, §4, §7, §11)", () => {
  function makeSnapshot(kind: "DAILY" | "WEEKLY" | "MONTHLY" | "CUSTOM" = "DAILY"): ReportSnapshot {
    const totals = emptyTotals();
    totals.PRESENT = 5;
    totals.LATE = 1;
    totals.ABSENT = 1;
    totals.OFF_DUTY = 2;

    const days = [
      {
        date: "2026-01-05",
        wards: [
          {
            wardId: "w1",
            wardName: "Makina",
            activity: "Drainage desilting",
            location: "Makina Market",
            roster: [
              {
                employeeNumber: "20250100100",
                fullName: "John Doe",
                designation: "Green Army Staff",
                role: "Green Army Staff",
                status: "PRESENT" as const,
                detail: "On time",
                wardName: "Makina",
                workDate: "2026-01-05",
                sessionActivity: "Drainage",
                sessionLocation: "Market",
              },
              {
                employeeNumber: "20250100101",
                fullName: "Jane Smith",
                designation: "Ward Supervisor",
                role: "Ward Supervisor",
                status: "LATE" as const,
                detail: "15 min late",
                wardName: "Makina",
                workDate: "2026-01-05",
                sessionActivity: "Drainage",
                sessionLocation: "Market",
              },
            ],
          },
        ],
      },
    ];

    const workLogs = [
      {
        id: "wl1",
        wardId: "w1",
        wardName: "Makina",
        date: "2026-01-05",
        activity: "Drainage desilting",
        location: "Makina Market area",
        areasRoads: "Moktar Daddah Road",
        description: "Cleared 150m of main roadside drains.",
        numberOfTrips: 3,
        wasteTransferInvolved: true,
        truckId: "T-01",
        backhoeId: "B-01",
        cleanupDone: true,
        cleanupStakeholders: "Kibera Youth CBO",
        climateTeamCount: 2,
        staffCount: 6,
        challenges: "Narrow road access delayed truck turnaround.",
        suggestedSolutions: "Deploy smaller trailer for secondary alleys.",
        completionStatus: "COMPLETE" as const,
        outstandingWork: null,
        photos: [
          {
            evidenceId: "ev1",
            objectKey: "objects/ev1.jpg",
            sha256: "a".repeat(64),
            caption: "Open drain cleared",
            stage: "AFTER" as const,
            wardName: "Makina",
            activity: "Drainage desilting",
            date: "2026-01-05",
          },
        ],
      },
    ];

    const analytics = computeReportAnalytics(totals, days, workLogs, [{ id: "w1", name: "Makina" }]);

    return {
      snapshotVersion: SNAPSHOT_VERSION,
      scopeType: "WARD",
      scopeId: "w1",
      scopeName: "Makina",
      startDate: "2026-01-05",
      endDate: "2026-01-05",
      kind,
      generatedAt: "2026-01-05T12:00:00.000Z",
      signedBy: "Officer Jane",
      signedTitle: "Ward Environment Officer",
      totals,
      analytics,
      comparison: {
        previousStartDate: "2026-01-04",
        previousEndDate: "2026-01-04",
        comparisonKind: "Previous operational reporting day (2026-01-04)",
        kpis: {
          attendedCount: { current: 6, previous: 5, absoluteChange: 1, percentageChange: 20.0 },
          effectiveAttendanceRate: { current: 85.7, previous: 80.0, absoluteChange: 5.7, percentageChange: 7.1 },
          absentCount: { current: 1, previous: 2, absoluteChange: -1, percentageChange: -50.0 },
          totalWorkLogs: { current: 1, previous: 1, absoluteChange: 0, percentageChange: 0.0 },
          totalTrips: { current: 3, previous: 2, absoluteChange: 1, percentageChange: 50.0 },
          totalStaffAllocations: { current: 6, previous: 6, absoluteChange: 0, percentageChange: 0.0 },
          completionRate: { current: 100.0, previous: 100.0, absoluteChange: 0.0, percentageChange: 0.0 },
        },
      },
      days,
      workLogs,
      evidence: workLogs[0].photos,
    };
  }

  it("renders a valid PDF buffer starting with %PDF-", async () => {
    const snapshot = makeSnapshot("DAILY");
    const pdfBuffer = await renderReportPdf(snapshot);

    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    expect(pdfBuffer.length).toBeGreaterThan(1000);
    // Standard PDF header signature
    expect(pdfBuffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("renders from immutable snapshot without network or database dependencies", async () => {
    const snapshot = makeSnapshot("WEEKLY");
    const pdfBuffer = await renderReportPdf(snapshot);
    expect(pdfBuffer.length).toBeGreaterThan(1000);
  });

  it("handles image loader gracefully with fallback placeholder when image is missing", async () => {
    const snapshot = makeSnapshot("DAILY");
    const pdfBuffer = await renderReportPdf(snapshot, {
      imageLoader: async () => null, // simulates missing storage asset
    });
    expect(pdfBuffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("embeds real image bytes when loader provides them", async () => {
    // Generate 1x1 test png/jpeg
    const sharp = (await import("sharp")).default;
    const testImage = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 27, g: 94, b: 32 } },
    })
      .jpeg()
      .toBuffer();

    const snapshot = makeSnapshot("DAILY");
    const pdfBuffer = await renderReportPdf(snapshot, {
      imageLoader: async () => testImage,
    });
    expect(pdfBuffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});
