import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PrismaClient } from "@ward-ops/database";
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

function todayNairobi(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function workLogPayload(wardId: string, overrides: Record<string, unknown> = {}) {
  return {
    wardId,
    workDate: todayNairobi(),
    activity: "Drainage desilting",
    location: "Makina Market area",
    areasRoads: "Moktar Daddah Road",
    description: "Desilted open drains along the market",
    staffCount: 12,
    challenges: "Rain delayed progress",
    suggestedSolutions: "Schedule drainage work before forecast rainfall",
    truthConfirmed: true,
    numberOfTrips: 0,
    wasteTransferInvolved: false,
    truckId: "",
    backhoeId: "",
    cleanupDone: false,
    cleanupStakeholders: "",
    climateTeamCount: 0,
    completionStatus: "COMPLETE",
    outstandingWork: "",
    ...overrides,
  };
}

describe("work operations (integration)", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaClient;

  let makinaWard: { id: string; code: string };
  let woodleyWard: { id: string; code: string };

  let officer: { cookie: string | null; csrf: string | null };
  let reviewer: { cookie: string | null; csrf: string | null };

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await buildApp(testConfig(TEST_DB_URL));
    makinaWard = await prisma.ward.findUniqueOrThrow({ where: { code: "MAKINA" } });
    woodleyWard = await prisma.ward.findUniqueOrThrow({ where: { code: "WOODLEY" } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetAuthData(prisma);
    await prisma.workLog.deleteMany();

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
      scopeId: (await prisma.subcounty.findUniqueOrThrow({ where: { code: "KIBRA" } })).id,
    });
    reviewer = await login(app, "reviewer@makina.test", PASSWORD);
  });

  async function createWorkLog(payload: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
    const response = await api(app, {
      method: "POST",
      url: "/api/v1/work-logs",
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload,
    });
    return { status: response.statusCode, body: response.json() };
  }

  async function action(
    id: string,
    payload: Record<string, unknown>,
    session: { cookie: string | null; csrf: string | null } = reviewer,
  ): Promise<{ status: number; body: unknown }> {
    const expectedVersion = payload.expectedVersion ?? (
      await prisma.workLog.findUniqueOrThrow({ where: { id }, select: { version: true } })
    ).version;
    const response = await api(app, {
      method: "POST",
      url: `/api/v1/work-logs/${id}/actions`,
      cookie: session.cookie,
      csrf: session.csrf,
      payload: { ...payload, expectedVersion },
    });
    return { status: response.statusCode, body: response.json() };
  }

  async function attachEvidence(workLogId: string): Promise<void> {
    await prisma.evidence.create({
      data: {
        workLogId,
        objectKey: `test/${workLogId}.jpg`,
        stage: "BEFORE",
        contentType: "image/jpeg",
        size: 128,
        sha256: "a".repeat(64),
        uploadedBy: "test",
      },
    });
  }

  async function createSubmittedWorkLog(payload: Record<string, unknown>) {
    const draft = await createWorkLog(payload);
    const id = (draft.body as Record<string, any>).id;
    await attachEvidence(id);
    const submitted = await action(id, { action: "SUBMIT" }, officer);
    expect(submitted.status).toBe(201);
    return submitted;
  }

  it("creates a truthful draft work log with detail and operations", async () => {
    const { status, body } = await createWorkLog(workLogPayload(makinaWard.id));
    expect(status).toBe(201);
    const workLog = body as Record<string, any>;
    expect(workLog.status).toBe("DRAFT");
    expect(workLog.wardId).toBe(makinaWard.id);
    expect(workLog.activity).toBe("Drainage desilting");
    expect(workLog.detail.completionStatus).toBe("COMPLETE");
    expect(workLog.operations.areasRoads).toBe("Moktar Daddah Road");
    expect(workLog.suggestedSolutions).toContain("forecast rainfall");
    expect(workLog.truthConfirmed).toBe(true);
  });

  it("keeps a draft private until the submitting officer submits it", async () => {
    const { body } = await createWorkLog(workLogPayload(makinaWard.id));
    const id = (body as Record<string, any>).id;

    const reviewerList = await api(app, {
      method: "GET",
      url: "/api/v1/work-logs",
      cookie: reviewer.cookie,
    });
    expect(reviewerList.statusCode).toBe(200);
    expect((reviewerList.json() as Array<{ id: string }>).some((item) => item.id === id)).toBe(false);

    const hiddenDraft = await api(app, {
      method: "GET",
      url: `/api/v1/work-logs/${id}`,
      cookie: reviewer.cookie,
    });
    expect(hiddenDraft.statusCode).toBe(404);

    await attachEvidence(id);
    expect((await action(id, { action: "SUBMIT" }, officer)).status).toBe(201);

    const visibleSubmission = await api(app, {
      method: "GET",
      url: `/api/v1/work-logs/${id}`,
      cookie: reviewer.cookie,
    });
    expect(visibleSubmission.statusCode).toBe(200);
  });

  it("requires photo evidence before the officer submits a draft", async () => {
    const { body } = await createWorkLog(workLogPayload(makinaWard.id));
    const id = (body as Record<string, any>).id;
    expect((await action(id, { action: "SUBMIT" }, officer)).status).toBe(400);
    await attachEvidence(id);
    const submitted = await action(id, { action: "SUBMIT" }, officer);
    expect(submitted.status).toBe(201);
    expect((submitted.body as Record<string, any>).status).toBe("SUBMITTED");
  });

  it("records waste transfer operations", async () => {
    const { status, body } = await createWorkLog(
      workLogPayload(makinaWard.id, {
        wasteTransferInvolved: true,
        numberOfTrips: 4,
        truckId: "T-161",
      }),
    );
    expect(status).toBe(201);
    const workLog = body as Record<string, any>;
    expect(workLog.operations.wasteTransferInvolved).toBe(true);
    expect(workLog.operations.numberOfTrips).toBe(4);
    expect(workLog.operations.truckId).toBe("T-161");
  });

  it("rejects waste transfer without a trip or vehicle", async () => {
    const { status } = await createWorkLog(
      workLogPayload(makinaWard.id, { wasteTransferInvolved: true }),
    );
    expect(status).toBe(422);
  });

  it("rejects malformed truck and backhoe identifiers", async () => {
    const truck = await createWorkLog(
      workLogPayload(makinaWard.id, { wasteTransferInvolved: true, numberOfTrips: 1, truckId: "truck1" }),
    );
    expect(truck.status).toBe(422);

    const backhoe = await createWorkLog(
      workLogPayload(makinaWard.id, { wasteTransferInvolved: true, numberOfTrips: 1, backhoeId: "backhoe-1" }),
    );
    expect(backhoe.status).toBe(422);
  });

  it("rejects cleanup without stakeholders or climate team", async () => {
    const { status } = await createWorkLog(
      workLogPayload(makinaWard.id, { cleanupDone: true }),
    );
    expect(status).toBe(422);
  });

  it("records cleanup stakeholders", async () => {
    const { status, body } = await createWorkLog(
      workLogPayload(makinaWard.id, {
        cleanupDone: true,
        cleanupStakeholders: "Nairobi Rivers Commission",
      }),
    );
    expect(status).toBe(201);
    expect((body as Record<string, any>).operations.cleanupDone).toBe(true);
  });

  it("requires a description of outstanding work when incomplete", async () => {
    const { status } = await createWorkLog(
      workLogPayload(makinaWard.id, { completionStatus: "INCOMPLETE" }),
    );
    expect(status).toBe(422);
  });

  it("records incomplete work with outstanding work", async () => {
    const { status, body } = await createWorkLog(
      workLogPayload(makinaWard.id, {
        completionStatus: "INCOMPLETE",
        outstandingWork: "Drain behind the stalls remains blocked",
      }),
    );
    expect(status).toBe(201);
    const workLog = body as Record<string, any>;
    expect(workLog.detail.completionStatus).toBe("INCOMPLETE");
    expect(workLog.detail.outstandingWork).toBe("Drain behind the stalls remains blocked");
  });

  it("lets a subcounty reviewer approve a submitted work log", async () => {
    const { body } = await createSubmittedWorkLog(workLogPayload(makinaWard.id));
    const id = (body as Record<string, any>).id;
    const { status, body: result } = await action(id, { action: "APPROVE" });
    expect(status).toBe(201);
    expect((result as Record<string, any>).status).toBe("APPROVED");
    expect((result as Record<string, any>).reviewedBy).toBeTruthy();
  });

  it("rejects a stale work-log transition version", async () => {
    const { body } = await createSubmittedWorkLog(workLogPayload(makinaWard.id));
    const id = (body as Record<string, any>).id;
    const stale = await action(id, { action: "APPROVE", expectedVersion: 3 });
    expect(stale.status).toBe(409);
    expect((await prisma.workLog.findUniqueOrThrow({ where: { id } })).status).toBe("SUBMITTED");
  });

  it("rejects a submitted work log with a note", async () => {
    const { body } = await createSubmittedWorkLog(workLogPayload(makinaWard.id));
    const id = (body as Record<string, any>).id;
    const { status, body: result } = await action(
      id,
      { action: "REJECT", reviewNote: "Details missing" },
    );
    expect(status).toBe(201);
    expect((result as Record<string, any>).status).toBe("REJECTED");
    expect((result as Record<string, any>).reviewNote).toBe("Details missing");
  });

  it("requires a rejection note", async () => {
    const { body } = await createSubmittedWorkLog(workLogPayload(makinaWard.id));
    const id = (body as Record<string, any>).id;
    const { status } = await action(id, { action: "REJECT" });
    expect(status).toBe(400);
  });

  it("forbids a ward officer from approving (no WORK_REVIEW)", async () => {
    const { body } = await createSubmittedWorkLog(workLogPayload(makinaWard.id));
    const id = (body as Record<string, any>).id;
    const { status } = await action(id, { action: "APPROVE" }, officer);
    expect(status).toBe(403);
  });

  it("rejects a transition from a terminal status", async () => {
    const { body } = await createSubmittedWorkLog(workLogPayload(makinaWard.id));
    const id = (body as Record<string, any>).id;
    await action(id, { action: "APPROVE" });
    const { status } = await action(id, { action: "APPROVE" });
    expect(status).toBe(409);
  });

  it("keeps work logs scoped to the requesting user's wards", async () => {
    await createWorkLog(workLogPayload(makinaWard.id));
    await prisma.workLog.create({
      data: {
        wardId: woodleyWard.id,
        workDate: new Date(`${todayNairobi()}T00:00:00.000Z`),
        activity: "Woodley cleanup",
        location: "Woodley Village",
        description: "Woodley ward cleanup",
        staffCount: 5,
        status: "SUBMITTED",
        submittedBy: "test",
        detail: { create: { completionStatus: "COMPLETE", outstandingWork: null } },
        operations: {
          create: {
            areasRoads: "Woodley roads",
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

    const list = await api(app, {
      method: "GET",
      url: "/api/v1/work-logs",
      cookie: officer.cookie,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);
  });

  it("does not expose another ward's work log by id or action", async () => {
    const foreign = await prisma.workLog.create({
      data: {
        wardId: woodleyWard.id,
        workDate: new Date(`${todayNairobi()}T00:00:00.000Z`),
        activity: "Woodley cleanup",
        location: "Woodley Village",
        description: "Woodley ward cleanup",
        staffCount: 5,
        status: "SUBMITTED",
        submittedBy: "test",
        detail: { create: { completionStatus: "COMPLETE", outstandingWork: null } },
        operations: {
          create: {
            areasRoads: "Woodley roads",
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

    const hidden = await api(app, {
      method: "GET",
      url: `/api/v1/work-logs/${foreign.id}`,
      cookie: officer.cookie,
    });
    expect(hidden.statusCode).toBe(404);

    const acted = await action(foreign.id, { action: "APPROVE" }, officer);
    expect(acted.status).toBe(404);
  });

  it("filters by work date and status", async () => {
    await createWorkLog(workLogPayload(makinaWard.id));
    const tomorrow = await createWorkLog(
      workLogPayload(makinaWard.id, { workDate: addDays(todayNairobi(), 1) }),
    );
    const futureId = (tomorrow.body as Record<string, any>).id;

    const todayList = await api(app, {
      method: "GET",
      url: `/api/v1/work-logs?workDate=${todayNairobi()}`,
      cookie: officer.cookie,
    });
    expect(todayList.statusCode).toBe(200);
    expect(todayList.json()).toHaveLength(1);

    const approvedList = await api(app, {
      method: "GET",
      url: `/api/v1/work-logs?status=APPROVED`,
      cookie: officer.cookie,
    });
    expect(approvedList.statusCode).toBe(200);
    expect(approvedList.json()).toHaveLength(0);

    const byId = await api(app, {
      method: "GET",
      url: `/api/v1/work-logs/${futureId}`,
      cookie: officer.cookie,
    });
    expect(byId.statusCode).toBe(200);
    expect((byId.json() as Record<string, any>).workDate).toBe(addDays(todayNairobi(), 1));
  });
});
