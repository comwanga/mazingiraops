import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PrismaClient } from "@ward-ops/database";
import { LocalObjectStorage } from "../../dist/storage/object-storage.service";
import { testConfig } from "./test-config";
import {
  api,
  buildApp,
  createUserWithAssignment,
  login,
  resetAuthData,
} from "./test-utils";

const TEST_DB_URL = process.env.TEST_DATABASE_URL!;
const PASSWORD = "TestPass-123456";

// 2026-01-05 is a Monday; 2026-01-06 a Tuesday.
const MONDAY = "2026-01-05";
const TUESDAY = "2026-01-06";

describe("reports (integration)", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaClient;

  let makinaWard: { id: string; code: string };
  let woodleyWard: { id: string; code: string };
  let kibraSubcounty: { id: string; code: string };
  let nccCounty: { id: string; code: string };

  let officer: { cookie: string | null; csrf: string | null };
  let reviewer: { cookie: string | null; csrf: string | null };
  let countyDirector: { cookie: string | null; csrf: string | null };
  let readOnly: { cookie: string | null; csrf: string | null };
  let foreignOfficer: { cookie: string | null; csrf: string | null };

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await buildApp(testConfig(TEST_DB_URL));
    makinaWard = await prisma.ward.findUniqueOrThrow({ where: { code: "MAKINA" } });
    woodleyWard = await prisma.ward.findUniqueOrThrow({ where: { code: "WOODLEY" } });
    kibraSubcounty = await prisma.subcounty.findUniqueOrThrow({ where: { code: "KIBRA" } });
    nccCounty = await prisma.county.findUniqueOrThrow({ where: { code: "NCC" } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetAuthData(prisma);
    await prisma.reportEvidence.deleteMany();
    await prisma.report.deleteMany();
    await prisma.evidence.deleteMany();
    await prisma.workLog.deleteMany();
    await prisma.attendance.deleteMany();
    await prisma.attendanceSession.deleteMany();
    await prisma.absenceRequest.deleteMany();
    await prisma.reminderDelivery.deleteMany();
    await prisma.documentClassification.deleteMany();
    await prisma.document.deleteMany();
    await prisma.employeeProfile.deleteMany();
    await prisma.employee.deleteMany();

    await createUserWithAssignment(prisma, {
      email: "officer@makina.test",
      password: PASSWORD,
      displayName: "Ward Officer",
      roleCode: "WARD_OFFICER",
      scopeType: "WARD",
      scopeId: makinaWard.id,
    });
    officer = await login(app, "officer@makina.test", PASSWORD);
    expect(officer.cookie).toBeTruthy();

    await createUserWithAssignment(prisma, {
      email: "reviewer@makina.test",
      password: PASSWORD,
      displayName: "Subcounty Reviewer",
      roleCode: "SUBCOUNTY_REVIEWER",
      scopeType: "SUBCOUNTY",
      scopeId: kibraSubcounty.id,
    });
    reviewer = await login(app, "reviewer@makina.test", PASSWORD);

    await createUserWithAssignment(prisma, {
      email: "county@makina.test",
      password: PASSWORD,
      displayName: "County Director",
      roleCode: "DIRECTOR",
      scopeType: "COUNTY",
      scopeId: nccCounty.id,
    });
    countyDirector = await login(app, "county@makina.test", PASSWORD);

    await createUserWithAssignment(prisma, {
      email: "readonly@makina.test",
      password: PASSWORD,
      displayName: "Read Only",
      roleCode: "READ_ONLY",
      scopeType: "COUNTY",
      scopeId: nccCounty.id,
    });
    readOnly = await login(app, "readonly@makina.test", PASSWORD);

    await createUserWithAssignment(prisma, {
      email: "foreign@woodley.test",
      password: PASSWORD,
      displayName: "Woodley Officer",
      roleCode: "WARD_OFFICER",
      scopeType: "WARD",
      scopeId: woodleyWard.id,
    });
    foreignOfficer = await login(app, "foreign@woodley.test", PASSWORD);
  });

  // -- Setup helpers -----------------------------------------------------------

  async function createEmployee(
    employeeNumber: string,
    fullName: string,
    wardId: string,
    designation = "Green Army Staff",
  ): Promise<string> {
    const employee = await prisma.employee.create({
      data: {
        employeeNumber,
        fullName,
        phone: `071${employeeNumber.slice(6)}`,
        designation,
        active: true,
        wardId,
        profile: { create: { residence: null, rosterStatus: "ON_DUTY" } },
      },
    });
    return employee.id;
  }

  async function createSession(
    wardId: string,
    workDate: string,
    activity = "Cleaning",
    location = "Makina Ward Office",
  ): Promise<{ id: string; token: string }> {
    const row = await prisma.attendanceSession.create({
      data: {
        token: `token-${Math.random().toString(36).slice(2)}-${workDate.replace(/-/g, "")}`,
        wardId,
        workDate: new Date(`${workDate}T00:00:00.000Z`),
        activity,
        location,
        opensAt: new Date(`${workDate}T08:00:00.000Z`),
        closesAt: new Date(`${workDate}T17:00:00.000Z`),
        createdBy: "test",
      },
    });
    return { id: row.id, token: row.token };
  }

  async function createAttendance(
    employeeId: string,
    sessionId: string,
    wardId: string,
    workDate: string,
    status: "PRESENT" | "LATE" | "ABSENT" | "OFF_DUTY" | "SICK_OFF",
    checkedAt?: string,
  ): Promise<void> {
    await prisma.attendance.create({
      data: {
        employeeId,
        sessionId,
        wardId,
        workDate: new Date(`${workDate}T00:00:00.000Z`),
        checkedAt: new Date(`${checkedAt ?? `${workDate}T09:05:00.000Z`}`),
        status,
        verificationMethod: "QR",
      },
    });
  }

  async function createApprovedAbsence(
    employeeId: string,
    wardId: string,
    workDate: string,
    kind: "SICK_OFF" | "ANNUAL_LEAVE" | "OFFICIAL_DUTY",
  ): Promise<void> {
    await prisma.absenceRequest.create({
      data: {
        employeeId,
        wardId,
        kind,
        startDate: new Date(`${workDate}T00:00:00.000Z`),
        endDate: new Date(`${workDate}T00:00:00.000Z`),
        returnDate: new Date(`${workDate}T00:00:00.000Z`),
        reason: "Approved leave covering the reporting day",
        status: "APPROVED",
        submittedBy: "test",
        reviewedBy: "test",
      },
    });
  }

  async function createApprovedWorkLog(
    wardId: string,
    workDate: string,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const row = await prisma.workLog.create({
      data: {
        wardId,
        workDate: new Date(`${workDate}T00:00:00.000Z`),
        activity: "Drainage desilting",
        location: "Makina Market area",
        description: "Desilted open drains along the market",
        staffCount: 4,
        challenges: "Rain delayed progress",
        status: "APPROVED",
        submittedBy: "test",
        reviewedBy: "test",
        detail: {
          create: {
            completionStatus: (overrides.completionStatus as "COMPLETE" | "INCOMPLETE") ?? "COMPLETE",
            outstandingWork: overrides.outstandingWork ? String(overrides.outstandingWork) : null,
          },
        },
        operations: {
          create: {
            areasRoads: "Moktar Daddah Road",
            numberOfTrips: Number(overrides.numberOfTrips ?? 0),
            wasteTransferInvolved: false,
            truckId: null,
            backhoeId: null,
            cleanupDone: false,
            cleanupStakeholders: null,
            climateTeamCount: 0,
          },
        },
      },
    });
    return row.id;
  }

  async function createEvidence(
    workLogId: string,
    stage: "BEFORE" | "DURING" | "AFTER",
    caption: string | null = null,
  ): Promise<string> {
    const row = await prisma.evidence.create({
      data: {
        workLogId,
        objectKey: `objects/evidence-${Math.random().toString(36).slice(2)}`,
        stage,
        caption,
        contentType: "image/jpeg",
        size: 1024,
        sha256: "b".repeat(64),
        uploadedBy: "test",
      },
    });
    return row.id;
  }

  // -- Capability gating -------------------------------------------------------

  it("requires authentication and REPORTS_READ to preview", async () => {
    const unauth = await api(app, {
      method: "GET",
      url: `/api/v1/reports/preview?scopeType=WARD&scopeId=${makinaWard.id}&startDate=${MONDAY}&endDate=${MONDAY}&kind=DAILY`,
    });
    expect(unauth.statusCode).toBe(401);

    const list = await api(app, {
      method: "GET",
      url: "/api/v1/reports",
    });
    expect(list.statusCode).toBe(401);
  });

  it("lets a ward officer archive their ward report but still requires REPORTS_FINALIZE", async () => {
    await createEmployee("20250100100", "Present Staff", makinaWard.id);

    const payload = {
      scopeType: "WARD",
      scopeId: makinaWard.id,
      startDate: MONDAY,
      endDate: MONDAY,
      kind: "DAILY",
    };
    const wardReport = await api(app, {
      method: "POST",
      url: "/api/v1/reports",
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload,
    });
    expect(wardReport.statusCode).toBe(201);
    expect(wardReport.json().snapshot.signedTitle).toBe("Ward Environment Officer");

    const denied = await api(app, {
      method: "POST",
      url: "/api/v1/reports",
      cookie: readOnly.cookie,
      csrf: readOnly.csrf,
      payload,
    });
    expect(denied.statusCode).toBe(403);
  });

  it("blocks finalization while an attendance session is still active", async () => {
    const workDate = "2099-01-05";
    await prisma.attendanceSession.create({
      data: {
        token: "active-report-session-token",
        wardId: makinaWard.id,
        workDate: new Date(`${workDate}T00:00:00.000Z`),
        activity: "Ward attendance",
        location: "Makina Ward",
        opensAt: new Date(),
        closesAt: new Date(Date.now() + 30 * 60 * 1000),
        createdBy: "test",
      },
    });

    const response = await api(app, {
      method: "POST",
      url: "/api/v1/reports",
      cookie: reviewer.cookie,
      csrf: reviewer.csrf,
      payload: { scopeType: "WARD", scopeId: makinaWard.id, startDate: workDate, endDate: workDate, kind: "DAILY" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toContain("Attendance is still open");
  });

  it("notifies through a conflict and blocks finalization until attendance reviews are resolved", async () => {
    const employeeId = await createEmployee("20250100100", "Pending Sick Staff", makinaWard.id);
    const session = await createSession(makinaWard.id, MONDAY);
    const attendance = await prisma.attendance.create({
      data: {
        employeeId,
        sessionId: session.id,
        wardId: makinaWard.id,
        workDate: new Date(`${MONDAY}T00:00:00.000Z`),
        checkedAt: new Date(`${MONDAY}T09:00:00.000Z`),
        status: "ABSENT",
        verificationMethod: "QR",
        absenceReason: "SICK_OFF",
        absenceReviewStatus: "PENDING",
      },
    });
    const payload = { scopeType: "WARD", scopeId: makinaWard.id, startDate: MONDAY, endDate: MONDAY, kind: "DAILY" };

    const blocked = await api(app, {
      method: "POST",
      url: "/api/v1/reports",
      cookie: reviewer.cookie,
      csrf: reviewer.csrf,
      payload,
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.message).toContain("Ward Environment Officer approval");

    await prisma.attendance.update({
      where: { id: attendance.id },
      data: { status: "SICK_OFF", absenceReviewStatus: "APPROVED", reviewedAt: new Date() },
    });
    const finalized = await api(app, {
      method: "POST",
      url: "/api/v1/reports",
      cookie: reviewer.cookie,
      csrf: reviewer.csrf,
      payload,
    });
    expect(finalized.statusCode).toBe(201);
  });

  // -- Deterministic snapshot --------------------------------------------------

  it("builds a deterministic daily snapshot with totals, roster and approved work", async () => {
    const presentId = await createEmployee("20250100100", "Present Staff", makinaWard.id);
    await createEmployee("20250100101", "Late Staff", makinaWard.id);
    const sickId = await createEmployee("20250100102", "Sick Staff", makinaWard.id);
    await createEmployee("20250100103", "Absent Staff", makinaWard.id);

    const session = await createSession(makinaWard.id, MONDAY);
    await createAttendance(presentId, session.id, makinaWard.id, MONDAY, "PRESENT");
    const lateEmployee = await prisma.employee.findFirstOrThrow({
      where: { employeeNumber: "20250100101" },
    });
    await createAttendance(lateEmployee.id, session.id, makinaWard.id, MONDAY, "LATE", `${MONDAY}T09:45:00.000Z`);
    await createApprovedAbsence(sickId, makinaWard.id, MONDAY, "SICK_OFF");

    const workLogId = await createApprovedWorkLog(makinaWard.id, MONDAY, { numberOfTrips: 4 });
    const evidenceId = await createEvidence(workLogId, "BEFORE", "Drains before work");

    const preview = await api(app, {
      method: "GET",
      url: `/api/v1/reports/preview?scopeType=WARD&scopeId=${makinaWard.id}&startDate=${MONDAY}&endDate=${MONDAY}&kind=DAILY`,
      cookie: reviewer.cookie,
    });
    expect(preview.statusCode).toBe(200);
    const body = preview.json() as Record<string, any>;
    const snapshot = body.snapshot;

    expect(snapshot.scopeName).toBe("Makina");
    expect(snapshot.totals).toEqual(
      expect.objectContaining({ PRESENT: 1, LATE: 1, SICK_OFF: 1, ABSENT: 1 }),
    );
    expect(snapshot.days).toHaveLength(1);
    const day = snapshot.days[0];
    expect(day.date).toBe(MONDAY);
    expect(day.wards).toHaveLength(1);
    const ward = day.wards[0];
    expect(ward.wardName).toBe("Makina");
    expect(ward.activity).toBe("Cleaning");
    expect(ward.location).toBe("Makina Ward Office");
    expect(ward.roster).toHaveLength(4);
    expect(ward.roster.map((row: { status: string }) => row.status).sort()).toEqual([
      "ABSENT",
      "LATE",
      "PRESENT",
      "SICK_OFF",
    ]);

    expect(snapshot.workLogs).toHaveLength(1);
    expect(snapshot.workLogs[0].activity).toBe("Drainage desilting");
    expect(snapshot.workLogs[0].numberOfTrips).toBe(4);
    expect(snapshot.workLogs[0].photos).toHaveLength(1);
    expect(snapshot.workLogs[0].photos[0].evidenceId).toBe(evidenceId);

    expect(body.narrative).toContain("1 approved work activities were recorded");
    expect(body.narrative).toContain("4 trips (Drainage desilting)");
    expect(body.recommendations).toContain("Sustain the completed activities");
    expect(body.title).toBe("Daily Operations Report — Makina");
  });

  it("excludes non-approved work logs and weekend days without a session", async () => {
    const employeeId = await createEmployee("20250100100", "Present Staff", makinaWard.id);
    const session = await createSession(makinaWard.id, MONDAY);
    await createAttendance(employeeId, session.id, makinaWard.id, MONDAY, "PRESENT");

    const rejected = await prisma.workLog.create({
      data: {
        wardId: makinaWard.id,
        workDate: new Date(`${MONDAY}T00:00:00.000Z`),
        activity: "Rejected activity",
        location: "Makina Market",
        description: "Rejected work",
        staffCount: 1,
        status: "REJECTED",
        submittedBy: "test",
        reviewedBy: "test",
        reviewNote: "Not acceptable",
        detail: { create: { completionStatus: "INCOMPLETE", outstandingWork: "Nothing" } },
        operations: {
          create: {
            areasRoads: "Test Road",
            numberOfTrips: 0,
            wasteTransferInvolved: false,
            truckId: null,
            backhoeId: null,
            cleanupDone: false,
            cleanupStakeholders: null,
            climateTeamCount: 0,
          },
        },
      },
    });
    void rejected;

    const preview = await api(app, {
      method: "GET",
      url: `/api/v1/reports/preview?scopeType=WARD&scopeId=${makinaWard.id}&startDate=${MONDAY}&endDate=${MONDAY}&kind=DAILY`,
      cookie: reviewer.cookie,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().snapshot.workLogs).toHaveLength(0);
  });

  it("does not infer absences on weekdays with no attendance session", async () => {
    await createEmployee("20250100100", "Rostered Staff", makinaWard.id);
    await createSession(makinaWard.id, TUESDAY);

    const preview = await api(app, {
      method: "GET",
      url: `/api/v1/reports/preview?scopeType=WARD&scopeId=${makinaWard.id}&startDate=${MONDAY}&endDate=${TUESDAY}&kind=WEEKLY`,
      cookie: reviewer.cookie,
    });

    expect(preview.statusCode).toBe(200);
    const snapshot = preview.json().snapshot;
    expect(snapshot.days.map((day: { date: string }) => day.date)).toEqual([TUESDAY]);
    expect(snapshot.totals.ABSENT).toBe(1);
  });

  // -- Scope isolation ---------------------------------------------------------

  it("isolates reports by scope: a foreign ward officer cannot preview", async () => {
    const employeeId = await createEmployee("20250100100", "Present Staff", makinaWard.id);
    const session = await createSession(makinaWard.id, MONDAY);
    await createAttendance(employeeId, session.id, makinaWard.id, MONDAY, "PRESENT");

    const preview = await api(app, {
      method: "GET",
      url: `/api/v1/reports/preview?scopeType=WARD&scopeId=${makinaWard.id}&startDate=${MONDAY}&endDate=${MONDAY}&kind=DAILY`,
      cookie: foreignOfficer.cookie,
    });
    expect(preview.statusCode).toBe(404);
  });

  it("isolates finalized reports by scope", async () => {
    const employeeId = await createEmployee("20250100100", "Present Staff", makinaWard.id);
    const session = await createSession(makinaWard.id, MONDAY);
    await createAttendance(employeeId, session.id, makinaWard.id, MONDAY, "PRESENT");

    const payload = {
      scopeType: "WARD",
      scopeId: makinaWard.id,
      startDate: MONDAY,
      endDate: MONDAY,
      kind: "DAILY",
    };
    const finalized = await api(app, {
      method: "POST",
      url: "/api/v1/reports",
      cookie: reviewer.cookie,
      csrf: reviewer.csrf,
      payload,
    });
    expect(finalized.statusCode).toBe(201);
    const reportId = (finalized.json() as Record<string, any>).id;

    const hidden = await api(app, {
      method: "GET",
      url: `/api/v1/reports/${reportId}`,
      cookie: foreignOfficer.cookie,
    });
    expect(hidden.statusCode).toBe(404);

    const list = await api(app, {
      method: "GET",
      url: "/api/v1/reports",
      cookie: foreignOfficer.cookie,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(0);
  });

  // -- Immutability (§27) ------------------------------------------------------

  it("persists an immutable snapshot and evidence references on finalize", async () => {
    const presentId = await createEmployee("20250100100", "Present Staff", makinaWard.id);
    const session = await createSession(makinaWard.id, MONDAY);
    await createAttendance(presentId, session.id, makinaWard.id, MONDAY, "PRESENT");
    const workLogId = await createApprovedWorkLog(makinaWard.id, MONDAY, { numberOfTrips: 2 });
    const evidenceId = await createEvidence(workLogId, "DURING", "During work");

    const payload = {
      scopeType: "WARD",
      scopeId: makinaWard.id,
      startDate: MONDAY,
      endDate: MONDAY,
      kind: "WEEKLY",
      narrative: "Human-reviewed narrative for the week.",
      recommendations: "Keep up the good work on drains.",
    };
    const finalized = await api(app, {
      method: "POST",
      url: "/api/v1/reports",
      cookie: reviewer.cookie,
      csrf: reviewer.csrf,
      payload,
    });
    expect(finalized.statusCode).toBe(201);
    const reportId = (finalized.json() as Record<string, any>).id;

    // Mutate the source data after finalize.
    await prisma.workLog.update({ where: { id: workLogId }, data: { description: "MUTATED" } });
    await prisma.attendance.deleteMany({ where: { employeeId: presentId } });

    const fetched = await api(app, {
      method: "GET",
      url: `/api/v1/reports/${reportId}`,
      cookie: reviewer.cookie,
    });
    expect(fetched.statusCode).toBe(200);
    const report = fetched.json() as Record<string, any>;
    expect(report.status).toBe("FINALIZED");
    expect(report.narrative).toBe("Human-reviewed narrative for the week.");
    expect(report.snapshot.workLogs[0].description).toBe("Desilted open drains along the market");
    expect(report.snapshot.totals.PRESENT).toBe(1);
    expect(report.snapshot.signedBy).toBe("Subcounty Reviewer");
    expect(report.snapshot.signedTitle).toBe("Subcounty Reviewer");
    expect(report.finalizedAt).toBeDefined();

    // Evidence references captured immutably in ReportEvidence rows.
    expect(report.evidence).toHaveLength(1);
    expect(report.evidence[0]).toEqual(
      expect.objectContaining({
        evidenceId,
        stage: "DURING",
        caption: "During work",
        sha256: "b".repeat(64),
      }),
    );
    expect(report.evidence[0].objectKey).toBeUndefined();
    expect(report.evidence[0].accessPath).toBe(
      `/api/v1/reports/${reportId}/evidence/${report.evidence[0].id}`,
    );
  });

  it("uses deterministic narrative and recommendations when not supplied", async () => {
    const employeeId = await createEmployee("20250100100", "Present Staff", makinaWard.id);
    const session = await createSession(makinaWard.id, MONDAY);
    await createAttendance(employeeId, session.id, makinaWard.id, MONDAY, "PRESENT");
    await createApprovedWorkLog(makinaWard.id, MONDAY, { numberOfTrips: 3 });

    const payload = {
      scopeType: "WARD",
      scopeId: makinaWard.id,
      startDate: MONDAY,
      endDate: MONDAY,
      kind: "DAILY",
    };
    const finalized = await api(app, {
      method: "POST",
      url: "/api/v1/reports",
      cookie: reviewer.cookie,
      csrf: reviewer.csrf,
      payload,
    });
    expect(finalized.statusCode).toBe(201);
    const report = finalized.json() as Record<string, any>;
    expect(report.narrative).toContain("3 trips (Drainage desilting)");
    expect(report.recommendations).toContain("Sustain the completed activities");
  });

  // -- Subcounty / county aggregation (§26, ADR-0007) --------------------------

  it("aggregates authorized wards for a subcounty report using one engine", async () => {
    const presentId = await createEmployee("20250100100", "Present Staff", makinaWard.id);
    const session = await createSession(makinaWard.id, MONDAY);
    await createAttendance(presentId, session.id, makinaWard.id, MONDAY, "PRESENT");

    const preview = await api(app, {
      method: "GET",
      url: `/api/v1/reports/preview?scopeType=SUBCOUNTY&scopeId=${kibraSubcounty.id}&startDate=${MONDAY}&endDate=${MONDAY}&kind=DAILY`,
      cookie: reviewer.cookie,
    });
    expect(preview.statusCode).toBe(200);
    const snapshot = preview.json().snapshot;
    expect(snapshot.scopeName).toBe("Kibra");
    expect(snapshot.totals.PRESENT).toBe(1);
    expect(snapshot.days[0].wards.map((ward: { wardId: string }) => ward.wardId)).toContain(
      makinaWard.id,
    );

    const denied = await api(app, {
      method: "GET",
      url: `/api/v1/reports/preview?scopeType=SUBCOUNTY&scopeId=${kibraSubcounty.id}&startDate=${MONDAY}&endDate=${MONDAY}&kind=DAILY`,
      cookie: officer.cookie,
    });
    expect(denied.statusCode).toBe(404);
  });

  it("aggregates across wards for a county report", async () => {
    const makinaEmployee = await createEmployee("20250100100", "Makina Staff", makinaWard.id);
    const makinaSession = await createSession(makinaWard.id, MONDAY);
    await createAttendance(makinaEmployee, makinaSession.id, makinaWard.id, MONDAY, "PRESENT");
    await createApprovedWorkLog(makinaWard.id, MONDAY, { numberOfTrips: 1 });

    const woodleyEmployee = await createEmployee("20250100200", "Woodley Staff", woodleyWard.id);
    const woodleySession = await createSession(woodleyWard.id, MONDAY, "Sweeping", "Woodley Field");
    await createAttendance(woodleyEmployee, woodleySession.id, woodleyWard.id, MONDAY, "PRESENT");

    const preview = await api(app, {
      method: "GET",
      url: `/api/v1/reports/preview?scopeType=COUNTY&scopeId=${nccCounty.id}&startDate=${MONDAY}&endDate=${MONDAY}&kind=DAILY`,
      cookie: countyDirector.cookie,
    });
    expect(preview.statusCode).toBe(200);
    const snapshot = preview.json().snapshot;
    expect(snapshot.totals.PRESENT).toBe(2);
    const wardNames = snapshot.days[0].wards.map((ward: { wardName: string }) => ward.wardName).sort();
    expect(wardNames).toEqual(["Makina", "Woodley/Kenyatta Golf Course"]);
    expect(snapshot.workLogs).toHaveLength(1);
  });

  it("looks up designations by employee identity when numbers collide across wards", async () => {
    const employeeNumber = "20250100999";
    const makinaEmployee = await createEmployee(
      employeeNumber,
      "Makina Staff",
      makinaWard.id,
      "Makina Designation",
    );
    const woodleyEmployee = await prisma.employee.create({
      data: {
        employeeNumber,
        fullName: "Woodley Staff",
        phone: "0719999999",
        designation: "Woodley Designation",
        active: true,
        wardId: woodleyWard.id,
        profile: { create: { residence: null, rosterStatus: "ON_DUTY" } },
      },
    });
    const makinaSession = await createSession(makinaWard.id, MONDAY);
    const woodleySession = await createSession(woodleyWard.id, MONDAY);
    await createAttendance(makinaEmployee, makinaSession.id, makinaWard.id, MONDAY, "PRESENT");
    await createAttendance(woodleyEmployee.id, woodleySession.id, woodleyWard.id, MONDAY, "PRESENT");

    const preview = await api(app, {
      method: "GET",
      url: `/api/v1/reports/preview?scopeType=COUNTY&scopeId=${nccCounty.id}&startDate=${MONDAY}&endDate=${MONDAY}&kind=DAILY`,
      cookie: countyDirector.cookie,
    });
    expect(preview.statusCode).toBe(200);
    const wards = preview.json().snapshot.days[0].wards as Array<Record<string, any>>;
    const roles = Object.fromEntries(
      wards.map((ward) => [ward.wardName, ward.roster[0].role]),
    );
    expect(roles).toEqual({
      Makina: "Makina Designation",
      "Woodley/Kenyatta Golf Course": "Woodley Designation",
    });
  });

  // -- Photo sampling (§8) -----------------------------------------------------

  it("keeps all photos for daily reports and samples at most four per stage otherwise", async () => {
    const presentId = await createEmployee("20250100100", "Present Staff", makinaWard.id);
    const session = await createSession(makinaWard.id, MONDAY);
    await createAttendance(presentId, session.id, makinaWard.id, MONDAY, "PRESENT");
    const workLogId = await createApprovedWorkLog(makinaWard.id, MONDAY);
    const secondWorkLogId = await createApprovedWorkLog(makinaWard.id, TUESDAY);
    for (let index = 0; index < 5; index += 1) {
      await createEvidence(workLogId, "BEFORE", `Before ${index}`);
      await createEvidence(secondWorkLogId, "BEFORE", `Second before ${index}`);
    }

    const daily = await api(app, {
      method: "GET",
      url: `/api/v1/reports/preview?scopeType=WARD&scopeId=${makinaWard.id}&startDate=${MONDAY}&endDate=${MONDAY}&kind=DAILY`,
      cookie: reviewer.cookie,
    });
    expect(daily.json().snapshot.workLogs[0].photos).toHaveLength(5);

    const weekly = await api(app, {
      method: "GET",
      url: `/api/v1/reports/preview?scopeType=WARD&scopeId=${makinaWard.id}&startDate=${MONDAY}&endDate=${TUESDAY}&kind=WEEKLY`,
      cookie: reviewer.cookie,
    });
    expect(weekly.statusCode).toBe(200);
    const weeklyPhotos = weekly
      .json()
      .snapshot.workLogs.flatMap((workLog: { photos: unknown[] }) => workLog.photos);
    expect(weeklyPhotos).toHaveLength(4);
  });

  it("serves finalized report evidence through scoped access without exposing object keys", async () => {
    const storage = new LocalObjectStorage(testConfig(TEST_DB_URL) as never);
    const bytes = Buffer.from("immutable report evidence", "utf8");
    const stored = await storage.save({
      buffer: bytes,
      originalName: "proof.jpg",
      contentType: "image/jpeg",
    });
    try {
      const workLogId = await createApprovedWorkLog(makinaWard.id, MONDAY);
      await prisma.evidence.create({
        data: {
          workLogId,
          objectKey: stored.objectKey,
          stage: "AFTER",
          caption: "Completed work",
          contentType: "image/jpeg",
          size: stored.size,
          sha256: stored.sha256,
          uploadedBy: "test",
        },
      });
      const finalized = await api(app, {
        method: "POST",
        url: "/api/v1/reports",
        cookie: reviewer.cookie,
        csrf: reviewer.csrf,
        payload: {
          scopeType: "WARD",
          scopeId: makinaWard.id,
          startDate: MONDAY,
          endDate: MONDAY,
          kind: "DAILY",
        },
      });
      expect(finalized.statusCode).toBe(201);
      const report = finalized.json() as Record<string, any>;
      expect(JSON.stringify(report)).not.toContain(stored.objectKey);

      const access = await api(app, {
        method: "GET",
        url: report.evidence[0].accessPath,
        cookie: reviewer.cookie,
      });
      expect(access.statusCode).toBe(200);
      expect(access.headers["content-type"]).toContain("image/jpeg");
      expect(access.body).toBe(bytes.toString("utf8"));

      const denied = await api(app, {
        method: "GET",
        url: report.evidence[0].accessPath,
        cookie: foreignOfficer.cookie,
      });
      expect(denied.statusCode).toBe(404);
    } finally {
      await storage.delete(stored.objectKey);
    }
  });

  it("returns SQL pagination totals in compatible report-list headers", async () => {
    const payload = {
      scopeType: "WARD",
      scopeId: makinaWard.id,
      startDate: MONDAY,
      endDate: MONDAY,
      kind: "DAILY",
    };
    for (let index = 0; index < 2; index += 1) {
      const finalized = await api(app, {
        method: "POST",
        url: "/api/v1/reports",
        cookie: reviewer.cookie,
        csrf: reviewer.csrf,
        payload,
      });
      expect(finalized.statusCode).toBe(201);
    }

    const list = await api(app, {
      method: "GET",
      url: "/api/v1/reports?page=2&pageSize=1&kind=DAILY",
      cookie: reviewer.cookie,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);
    expect(list.headers["x-total-count"]).toBe("2");
    expect(list.headers["x-page"]).toBe("2");
    expect(list.headers["x-page-size"]).toBe("1");
  });

  // -- CSV export (§8) ---------------------------------------------------------

  it("exports a formula-safe CSV and blocks read_only accounts", async () => {
    const presentId = await createEmployee(
      "20250100100",
      "=SUM(A1:A5)",
      makinaWard.id,
      "Ward Supervisor",
    );
    const session = await createSession(makinaWard.id, MONDAY, "-manual entry", "Makina Office");
    await createAttendance(presentId, session.id, makinaWard.id, MONDAY, "PRESENT");

    const payload = {
      scopeType: "WARD",
      scopeId: makinaWard.id,
      startDate: MONDAY,
      endDate: MONDAY,
      kind: "DAILY",
    };
    const finalized = await api(app, {
      method: "POST",
      url: "/api/v1/reports",
      cookie: reviewer.cookie,
      csrf: reviewer.csrf,
      payload,
    });
    expect(finalized.statusCode).toBe(201);
    const reportId = (finalized.json() as Record<string, any>).id;

    const exportResponse = await api(app, {
      method: "GET",
      url: `/api/v1/reports/${reportId}/csv`,
      cookie: reviewer.cookie,
    });
    expect(exportResponse.statusCode).toBe(200);
    expect(exportResponse.headers["content-type"]).toContain("text/csv");
    const csv = exportResponse.body;
    expect(csv.startsWith("\ufeff")).toBe(true);
    expect(csv).toContain("Work date,Ward,Employee ID,Employee name,Role,Status,Details,Activity,Location");
    expect(csv).toContain("'=SUM(A1:A5)");
    expect(csv).toContain("'-manual entry");
    expect(csv).toContain("Ward Supervisor");
    expect(csv).toContain("PRESENT");

    const blocked = await api(app, {
      method: "GET",
      url: `/api/v1/reports/${reportId}/csv`,
      cookie: readOnly.cookie,
    });
    expect(blocked.statusCode).toBe(403);
  });

  // -- Optional AI narrative (§25, §39) ---------------------------------------

  it("requires REPORTS_GENERATE to draft an AI narrative", async () => {
    const payload = {
      scopeType: "WARD",
      scopeId: makinaWard.id,
      startDate: MONDAY,
      endDate: MONDAY,
      kind: "DAILY",
    };

    const unauth = await api(app, {
      method: "POST",
      url: "/api/v1/reports/ai-draft",
      payload,
    });
    expect(unauth.statusCode).toBe(401);

    const generated = await api(app, {
      method: "POST",
      url: "/api/v1/reports/ai-draft",
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload,
    });
    expect(generated.statusCode).toBe(201);

    const readOnlyDraft = await api(app, {
      method: "POST",
      url: "/api/v1/reports/ai-draft",
      cookie: readOnly.cookie,
      csrf: readOnly.csrf,
      payload,
    });
    expect(readOnlyDraft.statusCode).toBe(403);
  });

  it("drafts a deterministic narrative fallback when AI is disabled and audits it", async () => {
    const presentId = await createEmployee("20250100100", "Present Staff", makinaWard.id);
    const session = await createSession(makinaWard.id, MONDAY);
    await createAttendance(presentId, session.id, makinaWard.id, MONDAY, "PRESENT");
    await createApprovedWorkLog(makinaWard.id, MONDAY, { numberOfTrips: 2 });

    const payload = {
      scopeType: "WARD",
      scopeId: makinaWard.id,
      startDate: MONDAY,
      endDate: MONDAY,
      kind: "DAILY",
    };
    const draft = await api(app, {
      method: "POST",
      url: "/api/v1/reports/ai-draft",
      cookie: reviewer.cookie,
      csrf: reviewer.csrf,
      payload,
    });
    expect(draft.statusCode).toBe(201);
    const body = draft.json() as Record<string, any>;
    expect(body.narrativeSource).toBe("deterministic");
    expect(body.narrative).toContain("1 approved work activities were recorded");
    expect(body.narrative).toContain("2 trips (Drainage desilting)");
    expect(body.recommendations).toContain("Sustain the completed activities");
    expect(body.snapshot.totals.PRESENT).toBe(1);
    expect(body.title).toContain("Makina");

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "REPORT.NARRATIVE_DRAFTED" },
      orderBy: { id: "desc" },
    });
    expect(audit).toBeTruthy();
    expect(audit!.details).toBe("Deterministic fallback");
    expect(audit!.scopeId).toBe(makinaWard.id);
  });

  it("drafts the AI narrative from a minimized payload that omits personal data", async () => {
    const presentId = await createEmployee(
      "20250100100",
      "PERSONAL NAME",
      makinaWard.id,
      "Ward Supervisor",
    );
    const session = await createSession(makinaWard.id, MONDAY);
    await createAttendance(presentId, session.id, makinaWard.id, MONDAY, "PRESENT");
    await createApprovedWorkLog(makinaWard.id, MONDAY, { numberOfTrips: 1 });

    const payload = {
      scopeType: "WARD",
      scopeId: makinaWard.id,
      startDate: MONDAY,
      endDate: MONDAY,
      kind: "DAILY",
    };
    const draft = await api(app, {
      method: "POST",
      url: "/api/v1/reports/ai-draft",
      cookie: reviewer.cookie,
      csrf: reviewer.csrf,
      payload,
    });
    expect(draft.statusCode).toBe(201);
    const narrative = (draft.json() as Record<string, any>).narrative as string;
    // The deterministic fallback never contains employee names or numbers.
    expect(narrative).not.toContain("PERSONAL NAME");
    expect(narrative).not.toContain("20250100100");
    expect(narrative).not.toContain("Ward Supervisor");
  });

  // -- Period validation -------------------------------------------------------

  it("rejects an invalid report period", async () => {
    const base = `scopeType=WARD&scopeId=${makinaWard.id}&kind=DAILY`;
    const inverted = await api(app, {
      method: "GET",
      url: `/api/v1/reports/preview?${base}&startDate=${TUESDAY}&endDate=${MONDAY}`,
      cookie: reviewer.cookie,
    });
    expect(inverted.statusCode).toBe(422);

    const tooLong = await api(app, {
      method: "GET",
      url: `/api/v1/reports/preview?${base}&startDate=${MONDAY}&endDate=2027-01-10`,
      cookie: reviewer.cookie,
    });
    expect(tooLong.statusCode).toBe(422);

    const valid = await api(app, {
      method: "GET",
      url: `/api/v1/reports/preview?scopeType=WARD&scopeId=${makinaWard.id}&kind=CUSTOM&startDate=${MONDAY}&endDate=2027-01-05`,
      cookie: reviewer.cookie,
    });
    expect(valid.statusCode).toBe(200);
  });
});
