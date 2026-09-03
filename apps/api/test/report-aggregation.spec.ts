import { describe, expect, it } from "vitest";
import {
  AiHttpClient,
  ReportPhotoRef,
  ReportSnapshot,
  aiNarrative,
  calculatePreviousPeriod,
  canonicalSnapshotHash,
  computeReportAnalytics,
  computeReportComparison,
  deduplicateEvidence,
  deterministicNarrative,
  deterministicRecommendations,
  emptyTotals,
  enumerateDates,
  escapeCsvCell,
  fromDateString,
  isWeekend,
  reportTitle,
  samplePeriodPhotos,
  signerTitle,
  structuredAiPayload,
} from "../src/report/report-aggregation";

function photo(evidenceId: string, stage: "BEFORE" | "DURING" | "AFTER"): ReportPhotoRef {
  return {
    evidenceId,
    objectKey: `objects/${evidenceId}`,
    sha256: "a".repeat(64),
    caption: null,
    stage,
  };
}

describe("report aggregation (§25, §26, ADR-0007)", () => {
  describe("photo sampling (§8)", () => {
    it("keeps every photo for a daily report", () => {
      const photos = Array.from({ length: 6 }, (_, index) => photo(`e${index}`, "BEFORE"));
      expect(samplePeriodPhotos(photos, "DAILY")).toHaveLength(6);
      expect(samplePeriodPhotos(photos, "CUSTOM")).toHaveLength(6);
    });

    it("keeps all photos when a stage has at most four", () => {
      const photos = [
        photo("a", "BEFORE"),
        photo("b", "BEFORE"),
        photo("c", "DURING"),
      ];
      const sampled = samplePeriodPhotos(photos, "WEEKLY");
      expect(sampled.map((item) => item.evidenceId).sort()).toEqual(["a", "b", "c"]);
    });

    it("samples four evenly spaced photos per stage for weekly reports", () => {
      const photos = Array.from({ length: 5 }, (_, index) => photo(`e${index}`, "BEFORE"));
      const sampled = samplePeriodPhotos(photos, "WEEKLY");
      expect(sampled.map((item) => item.evidenceId).sort()).toEqual(["e0", "e1", "e3", "e4"]);
    });

    it("samples four evenly spaced photos when a stage has more than four", () => {
      const photos = Array.from({ length: 7 }, (_, index) => photo(`e${index}`, "BEFORE"));
      const sampled = samplePeriodPhotos(photos, "MONTHLY");
      expect(sampled).toHaveLength(4);
      // Legacy algorithm: round(index * (n-1) / 3) for n=7 -> 0, 2, 4, 6.
      expect(sampled.map((item) => item.evidenceId)).toEqual(["e0", "e2", "e4", "e6"]);
    });

    it("does not exceed four per stage when multiple stages are present", () => {
      const photos = [
        ...Array.from({ length: 6 }, (_, index) => photo(`b${index}`, "BEFORE")),
        ...Array.from({ length: 6 }, (_, index) => photo(`a${index}`, "AFTER")),
      ];
      const sampled = samplePeriodPhotos(photos, "WEEKLY");
      expect(sampled.filter((item) => item.stage === "BEFORE")).toHaveLength(4);
      expect(sampled.filter((item) => item.stage === "AFTER")).toHaveLength(4);
      expect(sampled).toHaveLength(8);
    });
  });

  describe("signer titles", () => {
    it("uses fixed titles that match the assigned role", () => {
      expect(signerTitle(["SYSTEM_ADMIN"])).toBe("System Administrator");
      expect(signerTitle(["SUBCOUNTY_REVIEWER"])).toBe("Subcounty Reviewer");
      expect(signerTitle(["WARD_OFFICER"])).toBe("Ward Environment Officer");
    });

    it("selects a title deterministically for multiple assignments", () => {
      expect(signerTitle(["WARD_OFFICER", "SYSTEM_ADMIN"])).toBe("System Administrator");
    });
  });

  describe("deterministic narrative", () => {
    it("reports attendance totals and approved work counts", () => {
      const totals = emptyTotals();
      totals.PRESENT = 3;
      totals.LATE = 1;
      totals.ABSENT = 2;
      const text = deterministicNarrative(totals, [
        { activity: "Drainage desilting", numberOfTrips: 4 },
        { activity: "Street sweeping", numberOfTrips: 0 },
      ]);
      expect(text).toContain("2 work activities were recorded");
      expect(text).toContain("3 present and 1 late entries");
      expect(text).toContain("2 absence entries");
      expect(text).toContain("Activities covered Drainage desilting, Street sweeping");
      expect(text).toContain("Recorded outputs included 4 trips (Drainage desilting)");
    });

    it("omits the activities and outputs sections when empty", () => {
      const text = deterministicNarrative(emptyTotals(), []);
      expect(text).toContain("0 work activities were recorded");
      expect(text).not.toContain("Activities covered");
      expect(text).not.toContain("Recorded outputs included");
    });
  });

  describe("deterministic recommendations", () => {
    it("prioritises incomplete activities", () => {
      const text = deterministicRecommendations([
        { activity: "Drainage desilting", completionStatus: "COMPLETE" },
        { activity: "Street sweeping", completionStatus: "INCOMPLETE" },
      ]);
      expect(text).toContain("Prioritise follow-up and completion of: Street sweeping");
    });

    it("returns the sustain message when everything is complete", () => {
      const text = deterministicRecommendations([
        { activity: "Drainage desilting", completionStatus: "COMPLETE" },
      ]);
      expect(text).toContain("Sustain the completed activities");
    });
  });

  describe("period helpers", () => {
    it("enumerates inclusive date-only ranges", () => {
      const dates = enumerateDates(
        fromDateString("2026-01-01"),
        fromDateString("2026-01-03"),
      );
      expect(dates).toHaveLength(3);
      expect(dates.map((date) => date.toISOString().slice(0, 10))).toEqual([
        "2026-01-01",
        "2026-01-02",
        "2026-01-03",
      ]);
    });

    it("flags Saturday and Sunday as weekend", () => {
      expect(isWeekend(fromDateString("2026-01-03"))).toBe(true); // Saturday
      expect(isWeekend(fromDateString("2026-01-04"))).toBe(true); // Sunday
      expect(isWeekend(fromDateString("2026-01-05"))).toBe(false); // Monday
    });
  });

  describe("report titles", () => {
    it("builds a title from kind and scope", () => {
      expect(reportTitle("DAILY", "Makina")).toBe("Daily Operations Report — Makina");
      expect(reportTitle("WEEKLY", "Kibra")).toBe("Weekly Operations Report — Kibra");
      expect(reportTitle("CUSTOM", "Makina")).toBe("Custom Operations Report — Makina");
    });
  });

  describe("CSV escaping (§8, §12)", () => {
    it("prefixes formula-injection cells with a single quote", () => {
      expect(escapeCsvCell("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
      expect(escapeCsvCell("+1+2")).toBe("'+1+2");
      expect(escapeCsvCell("-1+2")).toBe("'-1+2");
      expect(escapeCsvCell("@cmd")).toBe("'@cmd");
    });

    it("neutralizes formula-injection cells preceded by whitespace", () => {
      expect(escapeCsvCell(" =SUM(A1:A2)")).toBe("' =SUM(A1:A2)");
      expect(escapeCsvCell("\t+1+2")).toBe("'\t+1+2");
      expect(escapeCsvCell("  @cmd")).toBe("'  @cmd");
    });

    it("leaves ordinary values untouched", () => {
      expect(escapeCsvCell("Makina")).toBe("Makina");
      expect(escapeCsvCell(42)).toBe("42");
      expect(escapeCsvCell(null)).toBe("");
    });

    it("double-quotes cells containing commas, quotes or newlines", () => {
      expect(escapeCsvCell("a, b")).toBe('"a, b"');
      expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
      expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
    });
  });

  describe("structured AI payload (§8 privacy)", () => {
    function snapshotWithWork(): ReportSnapshot {
      const totals = emptyTotals();
      totals.PRESENT = 3;
      return {
        scopeType: "WARD",
        scopeId: "cly0",
        scopeName: "Makina",
        startDate: "2026-01-05",
        endDate: "2026-01-05",
        kind: "DAILY",
        generatedAt: "2026-01-05T10:00:00.000Z",
        signedBy: null,
        signedTitle: null,
        totals,
        days: [],
        workLogs: [
          {
            id: "wl1",
            wardId: "w1",
            wardName: "Makina",
            date: "2026-01-05",
            activity: "Drainage desilting",
            location: "Makina Market area",
            areasRoads: "Moktar Daddah Road",
            description: "Desilted open drains",
            numberOfTrips: 4,
            wasteTransferInvolved: false,
            truckId: null,
            backhoeId: null,
            cleanupDone: false,
            cleanupStakeholders: null,
            climateTeamCount: 0,
            staffCount: 6,
            challenges: "Rain delayed progress",
            completionStatus: "INCOMPLETE",
            outstandingWork: "Second-pass desilting",
            photos: [
              { evidenceId: "ev1", objectKey: "objects/ev1", sha256: "a".repeat(64), caption: null, stage: "AFTER" },
            ],
          },
        ],
      };
    }

    it("includes only period, totals and approved-work facts", () => {
      const payload = structuredAiPayload(snapshotWithWork());
      expect(payload.period).toEqual(["2026-01-05", "2026-01-05"]);
      expect(payload.attendanceTotals).toEqual({
        PRESENT: 3,
        LATE: 0,
        ABSENT: 0,
        OFF_DUTY: 0,
        SICK_OFF: 0,
        LEAVE: 0,
        OFFICIAL_DUTY: 0,
      });
      expect(payload.approvedWork).toHaveLength(1);
      expect(payload.approvedWork[0]).toEqual({
        date: "2026-01-05",
        activity: "Drainage desilting",
        location: "Makina Market area",
        areasRoads: "Moktar Daddah Road",
        numberOfTrips: 4,
        staffCount: 6,
        completionStatus: "INCOMPLETE",
      });
    });

    it("excludes employee numbers, phones, descriptions, challenges and evidence", () => {
      const payload = structuredAiPayload(snapshotWithWork());
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain("descript");
      expect(serialized).not.toContain("challenges");
      expect(serialized).not.toContain("Rain delayed");
      expect(serialized).not.toContain("outstandingWork");
      expect(serialized).not.toContain("objects/ev1");
      expect(serialized).not.toContain("evidence");
      expect(serialized).not.toContain("employeeNumber");
      expect(serialized).not.toContain("phone");
    });
  });

  describe("AI narrative (§25 optional, §8 fallback)", () => {
    const aiConfig = {
      enabled: true,
      baseUrl: "https://llm.test/v1",
      apiKey: "key-123",
      model: "llama-3.1-8b-instant",
    };
    const emptySnapshot: ReportSnapshot = {
      scopeType: "WARD",
      scopeId: "cly0",
      scopeName: "Makina",
      startDate: "2026-01-05",
      endDate: "2026-01-05",
      kind: "DAILY",
      generatedAt: "2026-01-05T10:00:00.000Z",
      signedBy: null,
      signedTitle: null,
      totals: emptyTotals(),
      days: [],
      workLogs: [],
    };

    it("uses the deterministic fallback when AI is disabled", async () => {
      const result = await aiNarrative(emptySnapshot, { ...aiConfig, enabled: false });
      expect(result.source).toBe("deterministic");
      expect(result.narrative).toBe(deterministicNarrative(emptySnapshot.totals, []));
    });

    it("uses the deterministic fallback when no API key is configured", async () => {
      const result = await aiNarrative(emptySnapshot, { ...aiConfig, apiKey: undefined });
      expect(result.source).toBe("deterministic");
    });

    it("POSTs the minimized payload and returns the model content", async () => {
      const requests: Array<{ url: string; init: Parameters<AiHttpClient>[1] }> = [];
      const http: AiHttpClient = async (url, init) => {
        requests.push({ url, init });
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: "  AI drafted narrative.  " } }],
          }),
        };
      };
      const result = await aiNarrative(emptySnapshot, aiConfig, http);
      expect(result.source).toBe("ai");
      expect(result.narrative).toBe("AI drafted narrative.");
      expect(requests[0].url).toBe("https://llm.test/v1/chat/completions");
      expect(requests[0].init.headers.Authorization).toBe("Bearer key-123");
      const sent = JSON.parse(requests[0].init.body) as { model: string; temperature: number; max_tokens: number };
      expect(sent.model).toBe("llama-3.1-8b-instant");
      expect(sent.temperature).toBe(0.1);
      expect(sent.max_tokens).toBe(600);
      expect(JSON.parse(requests[0].init.body).messages).toHaveLength(2);
    });

    it("falls back when the upstream request fails", async () => {
      const http: AiHttpClient = async () => ({ ok: false, json: async () => ({}) });
      const result = await aiNarrative(emptySnapshot, aiConfig, http);
      expect(result.source).toBe("deterministic");
    });

    it("falls back on malformed upstream responses", async () => {
      const http: AiHttpClient = async () => ({
        ok: true,
        json: async () => ({ choices: [] }),
      });
      const result = await aiNarrative(emptySnapshot, aiConfig, http);
      expect(result.source).toBe("deterministic");
    });

    it("falls back when the transport throws", async () => {
      const http: AiHttpClient = async () => {
        throw new Error("network down");
      };
      const result = await aiNarrative(emptySnapshot, aiConfig, http);
      expect(result.source).toBe("deterministic");
      expect(result.narrative).toBe(deterministicNarrative(emptySnapshot.totals, []));
    });
  });

  describe("deterministic analytics (§6, §9)", () => {
    it("computes authoritative attendance metrics across all seven statuses", () => {
      const totals = emptyTotals();
      totals.PRESENT = 8;
      totals.LATE = 2;
      totals.ABSENT = 2; // expectedOnDuty = 8 + 2 + 2 = 12
      totals.OFF_DUTY = 3;
      totals.LEAVE = 1;
      totals.SICK_OFF = 1;
      totals.OFFICIAL_DUTY = 1; // totalRostered = 18, excused = 6

      const days = [
        {
          date: "2026-01-05",
          wards: [
            {
              wardId: "w1",
              wardName: "Makina",
              activity: "Drainage",
              location: "Market",
              roster: [
                {
                  employeeNumber: "E001",
                  fullName: "Emp 1",
                  designation: "Green Army Staff",
                  role: "Green Army Staff",
                  status: "PRESENT" as const,
                  detail: "On time",
                },
                {
                  employeeNumber: "E002",
                  fullName: "Emp 2",
                  designation: "Green Army Staff",
                  role: "Green Army Staff",
                  status: "LATE" as const,
                  detail: "Late 15 min",
                },
                {
                  employeeNumber: "E003",
                  fullName: "Emp 3",
                  designation: "Green Army Staff",
                  role: "Green Army Staff",
                  status: "ABSENT" as const,
                  detail: "Unexcused",
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
          location: "Market",
          areasRoads: "Main Road",
          description: "Desilted 200m",
          numberOfTrips: 3,
          wasteTransferInvolved: true,
          truckId: "TRUCK-01",
          backhoeId: "BACKHOE-01",
          cleanupDone: true,
          cleanupStakeholders: "Community",
          climateTeamCount: 4,
          staffCount: 6,
          challenges: "Rain",
          suggestedSolutions: "Start earlier",
          completionStatus: "COMPLETE" as const,
          outstandingWork: null,
          photos: [],
        },
        {
          id: "wl2",
          wardId: "w1",
          wardName: "Makina",
          date: "2026-01-05",
          activity: "Drainage desilting",
          location: "Secondary",
          areasRoads: "Side Road",
          description: "Desilted 50m",
          numberOfTrips: 1,
          wasteTransferInvolved: false,
          truckId: null,
          backhoeId: null,
          cleanupDone: false,
          cleanupStakeholders: null,
          climateTeamCount: 0,
          staffCount: 4,
          challenges: null,
          suggestedSolutions: null,
          completionStatus: "INCOMPLETE" as const,
          outstandingWork: "Finishing touch",
          photos: [],
        },
      ];

      const analytics = computeReportAnalytics(totals, days, workLogs, [
        { id: "w1", name: "Makina" },
      ]);

      expect(analytics.totalRostered).toBe(18);
      expect(analytics.expectedOnDuty).toBe(12);
      expect(analytics.excusedCount).toBe(6);
      expect(analytics.attendedCount).toBe(10);
      // Effective rate: 10 / 12 = 83.3%
      expect(analytics.effectiveAttendanceRate).toBe(83.3);
      // Operational availability: (10 + 1) / 18 = 61.1%
      expect(analytics.operationalAvailabilityRate).toBe(61.1);

      // Distinct workforce personnel vs staff allocations
      expect(analytics.uniquePersonnelAttended).toBe(2); // E001 (PRESENT) + E002 (LATE)
      expect(analytics.totalStaffAllocations).toBe(10); // 6 + 4

      // Status distribution
      expect(analytics.statusDistribution.PRESENT).toEqual({ count: 8, percentage: 44.4 });
      expect(analytics.statusDistribution.LATE).toEqual({ count: 2, percentage: 11.1 });
      expect(analytics.statusDistribution.ABSENT).toEqual({ count: 2, percentage: 11.1 });
      expect(analytics.statusDistribution.OFF_DUTY).toEqual({ count: 3, percentage: 16.7 });

      // Operations & activity breakdown
      expect(analytics.totalWorkLogs).toBe(2);
      expect(analytics.totalTrips).toBe(4);
      expect(analytics.completeCount).toBe(1);
      expect(analytics.incompleteCount).toBe(1);
      expect(analytics.completionRate).toBe(50.0);
      expect(analytics.outstandingWorkCount).toBe(1);

      expect(analytics.operations.wasteTransferLogsCount).toBe(1);
      expect(analytics.operations.cleanupLogsCount).toBe(1);
      expect(analytics.operations.climateTeamTotal).toBe(4);
      expect(analytics.operations.trucksUsed).toEqual(["TRUCK-01"]);
      expect(analytics.operations.backhoesUsed).toEqual(["BACKHOE-01"]);

      expect(analytics.activityBreakdown).toHaveLength(1);
      expect(analytics.activityBreakdown[0]).toEqual({
        activity: "Drainage desilting",
        count: 2,
        staffAllocations: 10,
        trips: 4,
        complete: 1,
        incomplete: 1,
      });

      // Constituent ward comparison
      expect(analytics.constituentComparisons).toHaveLength(1);
      expect(analytics.constituentComparisons[0].name).toBe("Makina");
      expect(analytics.constituentComparisons[0].workLogsCount).toBe(2);
      expect(analytics.constituentComparisons[0].tripsCount).toBe(4);
    });
  });

  describe("equivalent-period comparisons (§8)", () => {
    it("determines previous operational reporting day for DAILY reports when lookback finds a session", () => {
      const activeSessions = ["2026-01-02", "2026-01-05"];
      // Monday 2026-01-05 looks back and finds Friday 2026-01-02
      const prev = calculatePreviousPeriod("2026-01-05", "2026-01-05", "DAILY", activeSessions);
      expect(prev.startDate).toBe("2026-01-02");
      expect(prev.endDate).toBe("2026-01-02");
      expect(prev.label).toContain("Previous operational reporting day");
    });

    it("falls back to previous calendar day when no prior session exists within lookback", () => {
      const prev = calculatePreviousPeriod("2026-01-05", "2026-01-05", "DAILY", []);
      expect(prev.startDate).toBe("2026-01-04");
      expect(prev.endDate).toBe("2026-01-04");
      expect(prev.label).toBe("Previous calendar day");
    });

    it("calculates exact preceding 7 days for WEEKLY reports", () => {
      const prev = calculatePreviousPeriod("2026-01-08", "2026-01-14", "WEEKLY");
      expect(prev.startDate).toBe("2026-01-01");
      expect(prev.endDate).toBe("2026-01-07");
      expect(prev.label).toBe("Previous week");
    });

    it("calculates preceding calendar month for full-month reports", () => {
      const prev = calculatePreviousPeriod("2026-02-01", "2026-02-28", "MONTHLY");
      expect(prev.startDate).toBe("2026-01-01");
      expect(prev.endDate).toBe("2026-01-31");
      expect(prev.label).toBe("Previous month");
    });

    it("calculates equal preceding duration for CUSTOM reports", () => {
      // 3 days: 2026-01-10 to 2026-01-12
      const prev = calculatePreviousPeriod("2026-01-10", "2026-01-12", "CUSTOM");
      expect(prev.startDate).toBe("2026-01-07");
      expect(prev.endDate).toBe("2026-01-09");
      expect(prev.label).toBe("Preceding equal period");
    });

    it("computes deterministic KPI deltas and percentage changes", () => {
      const currentTotals = emptyTotals();
      currentTotals.PRESENT = 10;
      const currentAnalytics = computeReportAnalytics(currentTotals, [], [
        {
          id: "1",
          wardId: "w1",
          wardName: "W1",
          date: "2026-01-05",
          activity: "Act",
          location: "Loc",
          areasRoads: "Road",
          description: "Desc",
          numberOfTrips: 6,
          wasteTransferInvolved: false,
          truckId: null,
          backhoeId: null,
          cleanupDone: false,
          cleanupStakeholders: null,
          climateTeamCount: 0,
          staffCount: 8,
          challenges: null,
          suggestedSolutions: null,
          completionStatus: "COMPLETE",
          outstandingWork: null,
          photos: [],
        },
      ]);

      const prevTotals = emptyTotals();
      prevTotals.PRESENT = 8;
      const prevAnalytics = computeReportAnalytics(prevTotals, [], [
        {
          id: "2",
          wardId: "w1",
          wardName: "W1",
          date: "2026-01-02",
          activity: "Act",
          location: "Loc",
          areasRoads: "Road",
          description: "Desc",
          numberOfTrips: 4,
          wasteTransferInvolved: false,
          truckId: null,
          backhoeId: null,
          cleanupDone: false,
          cleanupStakeholders: null,
          climateTeamCount: 0,
          staffCount: 4,
          challenges: null,
          suggestedSolutions: null,
          completionStatus: "COMPLETE",
          outstandingWork: null,
          photos: [],
        },
      ]);

      const comparison = computeReportComparison(
        currentAnalytics,
        prevAnalytics,
        "2026-01-02",
        "2026-01-02",
        "Previous operational reporting day",
      );

      // Attended: 10 vs 8 -> +2 (+25.0%)
      expect(comparison.kpis.attendedCount).toEqual({
        current: 10,
        previous: 8,
        absoluteChange: 2,
        percentageChange: 25.0,
      });

      // Trips: 6 vs 4 -> +2 (+50.0%)
      expect(comparison.kpis.totalTrips).toEqual({
        current: 6,
        previous: 4,
        absoluteChange: 2,
        percentageChange: 50.0,
      });

      // Staff allocations: 8 vs 4 -> +4 (+100.0%)
      expect(comparison.kpis.totalStaffAllocations).toEqual({
        current: 8,
        previous: 4,
        absoluteChange: 4,
        percentageChange: 100.0,
      });
    });
  });

  describe("canonical snapshot hash and evidence deduplication (§4, §9)", () => {
    it("generates identical hashes regardless of object key insertion order", () => {
      const obj1 = { b: 2, a: 1, nested: { y: "test", x: 10 } };
      const obj2 = { a: 1, nested: { x: 10, y: "test" }, b: 2 };
      expect(canonicalSnapshotHash(obj1)).toBe(canonicalSnapshotHash(obj2));
    });

    it("excludes any snapshotSha256 property from the hash input", () => {
      const base = { a: 1, b: 2 };
      const withHash = { a: 1, b: 2, snapshotSha256: "already-present-hash" };
      expect(canonicalSnapshotHash(base)).toBe(canonicalSnapshotHash(withHash));
    });

    it("deduplicates evidence items by object key without dropping unique photos", () => {
      const photos = [
        photo("ev1", "BEFORE"),
        photo("ev2", "DURING"),
        photo("ev1", "BEFORE"), // duplicate key/evidenceId
      ];
      const deduplicated = deduplicateEvidence(photos);
      expect(deduplicated).toHaveLength(2);
      expect(deduplicated.map((p) => p.evidenceId)).toEqual(["ev1", "ev2"]);
    });
  });
});

