import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PrismaClient } from "@ward-ops/database";
import { SYSTEM_ADMIN_CAPABILITIES } from "@ward-ops/contracts";
import { testConfig } from "./test-config";
import {
  api,
  bootstrapAdmin,
  buildApp,
  createUserWithAssignment,
  login,
  resetAuthData,
} from "./test-utils";

const TEST_DB_URL = process.env.TEST_DATABASE_URL!;
const PASSWORD = "UserPassword-123";

describe("user administration (integration)", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  let makinaWard: { id: string };
  let woodleyWard: { id: string };
  let likoniWard: { id: string };

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await buildApp(testConfig(TEST_DB_URL));
    makinaWard = await prisma.ward.findUniqueOrThrow({ where: { code: "MAKINA" } });
    woodleyWard = await prisma.ward.findUniqueOrThrow({ where: { code: "WOODLEY" } });
    likoniWard = await prisma.ward.findUniqueOrThrow({ where: { code: "LIKONI_WARD" } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetAuthData(prisma);
  });

  it("lists only scoped users and does not flatten mixed assignment authority", async () => {
    const admin = await bootstrapAdmin(app);
    await createUserWithAssignment(prisma, {
      email: "makina.user@makina.test",
      password: PASSWORD,
      displayName: "Makina User",
      roleCode: "READ_ONLY",
      scopeType: "WARD",
      scopeId: makinaWard.id,
    });
    await createUserWithAssignment(prisma, {
      email: "likoni.user@makina.test",
      password: PASSWORD,
      displayName: "Likoni User",
      roleCode: "READ_ONLY",
      scopeType: "WARD",
      scopeId: likoniWard.id,
    });

    const list = await api(app, {
      method: "GET",
      url: "/api/v1/users",
      cookie: admin.cookie,
    });
    expect(list.statusCode).toBe(200);
    const emails = list.json().users.map((user: { email: string }) => user.email);
    expect(emails).toContain("makina.user@makina.test");
    expect(emails).not.toContain("likoni.user@makina.test");

    const adminUser = await prisma.user.findUniqueOrThrow({
      where: { email: "admin@makina.test" },
    });
    const readOnlyRole = await prisma.role.findUniqueOrThrow({ where: { code: "READ_ONLY" } });
    await prisma.assignment.create({
      data: {
        userId: adminUser.id,
        roleId: readOnlyRole.id,
        scopeType: "WARD",
        wardId: likoniWard.id,
      },
    });
    const request = await prisma.accessRequest.create({
      data: {
        displayName: "Likoni Applicant",
        email: "likoni.applicant@makina.test",
        passwordHash: "not-used",
        reason: "Likoni access",
        requestedScope: "WARD",
        requestedScopeId: likoniWard.id,
      },
    });
    const reject = await api(app, {
      method: "POST",
      url: `/api/v1/users/access-requests/${request.id}/review`,
      cookie: admin.cookie,
      csrf: admin.csrf,
      payload: { action: "reject" },
    });
    expect(reject.statusCode).toBe(403);
  });

  it("disables, restores, resets passwords, and replaces assignments with session revocation", async () => {
    const admin = await bootstrapAdmin(app);
    const userId = await createUserWithAssignment(prisma, {
      email: "managed.user@makina.test",
      password: PASSWORD,
      displayName: "Managed User",
      roleCode: "READ_ONLY",
      scopeType: "WARD",
      scopeId: makinaWard.id,
    });
    const userSession = await login(app, "managed.user@makina.test", PASSWORD);

    const disabled = await api(app, {
      method: "POST",
      url: `/api/v1/users/${userId}/disable`,
      cookie: admin.cookie,
      csrf: admin.csrf,
    });
    expect(disabled.statusCode).toBe(200);
    expect((await api(app, {
      method: "GET",
      url: "/api/v1/auth/me",
      cookie: userSession.cookie,
    })).statusCode).toBe(401);
    expect((await login(app, "managed.user@makina.test", PASSWORD)).user).toBeUndefined();

    const restored = await api(app, {
      method: "POST",
      url: `/api/v1/users/${userId}/restore`,
      cookie: admin.cookie,
      csrf: admin.csrf,
    });
    expect(restored.statusCode).toBe(200);
    const restoredSession = await login(app, "managed.user@makina.test", PASSWORD);
    expect(restoredSession.user).toBeDefined();

    const reset = await api(app, {
      method: "POST",
      url: `/api/v1/users/${userId}/reset-password`,
      cookie: admin.cookie,
      csrf: admin.csrf,
      payload: { temporaryPassword: "TemporaryPass-456" },
    });
    expect(reset.statusCode).toBe(200);
    expect((await api(app, {
      method: "GET",
      url: "/api/v1/auth/me",
      cookie: restoredSession.cookie,
    })).statusCode).toBe(401);
    expect((await login(app, "managed.user@makina.test", PASSWORD)).user).toBeUndefined();
    expect((await login(app, "managed.user@makina.test", "TemporaryPass-456")).user?.mustChangePassword).toBe(true);

    const update = await api(app, {
      method: "PUT",
      url: `/api/v1/users/${userId}/assignments`,
      cookie: admin.cookie,
      csrf: admin.csrf,
      payload: {
        assignments: [{ roleCode: "WARD_OFFICER", scopeType: "WARD", scopeId: woodleyWard.id }],
      },
    });
    expect(update.statusCode).toBe(200);
    const assignment = await prisma.assignment.findFirstOrThrow({ where: { userId } });
    expect(assignment.wardId).toBe(woodleyWard.id);
  });

  it("serves a synchronized dashboard and configurable role permissions", async () => {
    const admin = await bootstrapAdmin(app);
    const dashboard = await api(app, {
      method: "GET",
      url: "/api/v1/dashboard",
      cookie: admin.cookie,
    });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json()).toEqual(expect.objectContaining({
      asOf: expect.any(String),
      metrics: expect.objectContaining({ activeStaff: expect.any(Number) }),
      queue: expect.any(Array),
    }));

    const catalog = await api(app, {
      method: "GET",
      url: "/api/v1/users/permissions",
      cookie: admin.cookie,
    });
    expect(catalog.statusCode).toBe(200);
    const readOnly = catalog.json().roles.find((role: { code: string }) => role.code === "READ_ONLY");
    expect(readOnly.capabilities).toEqual(expect.arrayContaining(["ATTENDANCE_READ", "REPORTS_READ"]));
    const update = await api(app, {
      method: "PUT",
      url: "/api/v1/users/roles/READ_ONLY/capabilities",
      cookie: admin.cookie,
      csrf: admin.csrf,
      payload: { capabilities: readOnly.capabilities },
    });
    expect(update.statusCode).toBe(200);
    expect(await prisma.auditEvent.count({ where: { action: "ROLE.PERMISSIONS_UPDATED" } })).toBe(1);
  });

  it("keeps system administration outside ward operations while allowing report viewing", async () => {
    const admin = await bootstrapAdmin(app);
    const catalog = await api(app, {
      method: "GET",
      url: "/api/v1/users/permissions",
      cookie: admin.cookie,
    });
    const systemAdmin = catalog.json().roles.find(
      (role: { code: string }) => role.code === "SYSTEM_ADMIN",
    );
    expect(systemAdmin.capabilities).toEqual([...SYSTEM_ADMIN_CAPABILITIES].sort());

    const staffList = await api(app, {
      method: "GET",
      url: "/api/v1/staff",
      cookie: admin.cookie,
    });
    expect(staffList.statusCode).toBe(403);

    const reportList = await api(app, {
      method: "GET",
      url: "/api/v1/reports",
      cookie: admin.cookie,
    });
    expect(reportList.statusCode).toBe(200);

    const expandPermissions = await api(app, {
      method: "PUT",
      url: "/api/v1/users/roles/SYSTEM_ADMIN/capabilities",
      cookie: admin.cookie,
      csrf: admin.csrf,
      payload: { capabilities: [...SYSTEM_ADMIN_CAPABILITIES, "STAFF_MANAGE"] },
    });
    expect(expandPermissions.statusCode).toBe(400);
  });
});
