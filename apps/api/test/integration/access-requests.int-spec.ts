import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PrismaClient } from "@ward-ops/database";
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
const REQUEST_PASSWORD = "RequestPass-123456";

describe("access requests (integration)", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  let makinaWard: { id: string };
  let mombasaCounty: { id: string };

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await buildApp(testConfig(TEST_DB_URL));
    makinaWard = await prisma.ward.findUniqueOrThrow({ where: { code: "MAKINA" } });
    mombasaCounty = await prisma.county.findUniqueOrThrow({ where: { code: "MOMBASA" } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetAuthData(prisma);
  });

  it("exposes a sanitized public organisation directory", async () => {
    const response = await api(app, {
      method: "GET",
      url: "/api/v1/organisations/public",
    });

    expect(response.statusCode).toBe(200);
    const county = response.json().counties.find(
      (item: { code: string }) => item.code === "NCC",
    );
    expect(county.name).toBe("Nairobi City County");
    expect(county.subcounties[0].wards[0]).toEqual(
      expect.objectContaining({ id: expect.any(String), code: expect.any(String), name: expect.any(String) }),
    );
    expect(JSON.stringify(response.json())).not.toContain("employee");
  });

  it("rejects unscoped and nonexistent-scope requests", async () => {
    const unscoped = await api(app, {
      method: "POST",
      url: "/api/v1/users/access-requests",
      payload: {
        displayName: "Unscoped Applicant",
        email: "unscoped@makina.test",
        password: REQUEST_PASSWORD,
        reason: "Request without an organisation scope",
      },
    });
    expect(unscoped.statusCode).toBe(422);

    const nonexistent = await api(app, {
      method: "POST",
      url: "/api/v1/users/access-requests",
      payload: {
        displayName: "Unknown Scope Applicant",
        email: "unknown.scope@makina.test",
        password: REQUEST_PASSWORD,
        reason: "Request for an unknown organisation scope",
        requestedScope: "WARD",
        requestedScopeId: "clzzzzzzzzzzzzzzzzzzzzzzz",
      },
    });
    expect(nonexistent.statusCode).toBe(400);
  });

  it("allows a public request and blocks duplicates", async () => {
    const response = await api(app, {
      method: "POST",
      url: "/api/v1/users/access-requests",
      payload: {
        displayName: "Jane Worker",
        email: "jane.worker@makina.test",
        password: REQUEST_PASSWORD,
        reason: "Field staff for the Makina green army",
        requestedScope: "WARD",
        requestedScopeId: makinaWard.id,
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().id).toBeDefined();

    const duplicate = await api(app, {
      method: "POST",
      url: "/api/v1/users/access-requests",
      payload: {
        displayName: "Jane Worker",
        email: "jane.worker@makina.test",
        password: REQUEST_PASSWORD,
        reason: "Another reason for the same email",
        requestedScope: "WARD",
        requestedScopeId: makinaWard.id,
      },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.message).toBe("An access request cannot be created for this email");
  });

  it("does not reveal whether an email already has an account or a pending request", async () => {
    await createUserWithAssignment(prisma, {
      email: "existing.user@makina.test",
      password: "ExistingPass-123",
      displayName: "Existing User",
      roleCode: "READ_ONLY",
      scopeType: "WARD",
      scopeId: makinaWard.id,
    });

    const response = await api(app, {
      method: "POST",
      url: "/api/v1/users/access-requests",
      payload: {
        displayName: "Existing User",
        email: "existing.user@makina.test",
        password: REQUEST_PASSWORD,
        reason: "Requesting access to the existing account",
        requestedScope: "WARD",
        requestedScopeId: makinaWard.id,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toBe("An access request cannot be created for this email");
  });

  it("approves a request, creates the account, and lets them log in", async () => {
    const admin = await bootstrapAdmin(app);

    const created = await api(app, {
      method: "POST",
      url: "/api/v1/users/access-requests",
      payload: {
        displayName: "Jane Worker",
        email: "jane.worker@makina.test",
        password: REQUEST_PASSWORD,
        reason: "Field staff for the Makina green army",
        requestedScope: "WARD",
        requestedScopeId: makinaWard.id,
      },
    });
    const requestId = created.json().id as string;

    const list = await api(app, {
      method: "GET",
      url: "/api/v1/users/access-requests",
      cookie: admin.cookie,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().requests.map((request: { id: string }) => request.id)).toContain(requestId);

    const approve = await api(app, {
      method: "POST",
      url: `/api/v1/users/access-requests/${requestId}/review`,
      cookie: admin.cookie,
      csrf: admin.csrf,
      payload: {
        action: "approve",
        roleCode: "READ_ONLY",
        scopeType: "WARD",
        scopeId: makinaWard.id,
      },
    });
    expect(approve.statusCode).toBe(201);
    expect(approve.json().status).toBe("APPROVED");

    const user = await prisma.user.findUnique({ where: { email: "jane.worker@makina.test" } });
    expect(user).not.toBeNull();
    expect(user!.mustChangePassword).toBe(true);

    const session = await login(app, "jane.worker@makina.test", REQUEST_PASSWORD);
    expect(session.user?.email).toBe("jane.worker@makina.test");

    const me = await api(app, {
      method: "GET",
      url: "/api/v1/auth/me",
      cookie: session.cookie,
    });
    expect(me.json().user.assignments[0].role).toBe("READ_ONLY");
  });

  it("rejects without creating an account", async () => {
    const admin = await bootstrapAdmin(app);
    const created = await api(app, {
      method: "POST",
      url: "/api/v1/users/access-requests",
      payload: {
        displayName: "Jane Worker",
        email: "jane.worker@makina.test",
        password: REQUEST_PASSWORD,
        reason: "Field staff for the Makina green army",
        requestedScope: "WARD",
        requestedScopeId: makinaWard.id,
      },
    });
    const requestId = created.json().id as string;

    const rejected = await api(app, {
      method: "POST",
      url: `/api/v1/users/access-requests/${requestId}/review`,
      cookie: admin.cookie,
      csrf: admin.csrf,
      payload: { action: "reject", note: "no vacancy" },
    });
    expect(rejected.statusCode).toBe(201);
    expect(rejected.json().status).toBe("REJECTED");

    const user = await prisma.user.findUnique({ where: { email: "jane.worker@makina.test" } });
    expect(user).toBeNull();
  });

  it("denies non-admins and out-of-scope approvals", async () => {
    await bootstrapAdmin(app);
    const created = await api(app, {
      method: "POST",
      url: "/api/v1/users/access-requests",
      payload: {
        displayName: "Jane Worker",
        email: "jane.worker@makina.test",
        password: REQUEST_PASSWORD,
        reason: "Field staff for the Makina green army",
        requestedScope: "WARD",
        requestedScopeId: makinaWard.id,
      },
    });
    const requestId = created.json().id as string;

    await createUserWithAssignment(prisma, {
      email: "officer@makina.test",
      password: "OfficerPass-123",
      displayName: "Officer",
      roleCode: "WARD_OFFICER",
      scopeType: "WARD",
      scopeId: makinaWard.id,
    });
    const officer = await login(app, "officer@makina.test", "OfficerPass-123");
    const denied = await api(app, {
      method: "POST",
      url: `/api/v1/users/access-requests/${requestId}/review`,
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload: { action: "approve", roleCode: "READ_ONLY", scopeType: "WARD", scopeId: makinaWard.id },
    });
    expect(denied.statusCode).toBe(403);

    await createUserWithAssignment(prisma, {
      email: "mombasa.admin@makina.test",
      password: "MombasaPass-123",
      displayName: "Mombasa Admin",
      roleCode: "SYSTEM_ADMIN",
      scopeType: "COUNTY",
      scopeId: mombasaCounty.id,
    });
    const mombasaAdmin = await login(app, "mombasa.admin@makina.test", "MombasaPass-123");
    const outOfScope = await api(app, {
      method: "POST",
      url: `/api/v1/users/access-requests/${requestId}/review`,
      cookie: mombasaAdmin.cookie,
      csrf: mombasaAdmin.csrf,
      payload: { action: "approve", roleCode: "READ_ONLY", scopeType: "WARD", scopeId: makinaWard.id },
    });
    expect(outOfScope.statusCode).toBe(403);
  });

  it("does not leak subcounty-scoped requests across counties", async () => {
    const admin = await bootstrapAdmin(app);
    const likoni = await prisma.subcounty.findUniqueOrThrow({ where: { code: "LIKONI" } });

    await api(app, {
      method: "POST",
      url: "/api/v1/users/access-requests",
      payload: {
        displayName: "Mombasa Applicant",
        email: "mombasa.applicant@makina.test",
        password: REQUEST_PASSWORD,
        reason: "Field staff for Likoni",
        requestedScope: "SUBCOUNTY",
        requestedScopeId: likoni.id,
      },
    });

    const list = await api(app, {
      method: "GET",
      url: "/api/v1/users/access-requests",
      cookie: admin.cookie,
    });
    const emails = list.json().requests.map((request: { email: string }) => request.email);
    expect(emails).not.toContain("mombasa.applicant@makina.test");

    const rejected = await api(app, {
      method: "POST",
      url: `/api/v1/users/access-requests/${(
        await prisma.accessRequest.findFirstOrThrow({
          where: { email: "mombasa.applicant@makina.test" },
        })
      ).id}/review`,
      cookie: admin.cookie,
      csrf: admin.csrf,
      payload: { action: "reject", note: "outside county" },
    });
    expect(rejected.statusCode).toBe(403);
  });

  it("forces a password change before other endpoints are usable", async () => {
    const admin = await bootstrapAdmin(app);
    const created = await api(app, {
      method: "POST",
      url: "/api/v1/users/access-requests",
      payload: {
        displayName: "New Officer",
        email: "new.officer@makina.test",
        password: REQUEST_PASSWORD,
        reason: "Field staff for Makina",
        requestedScope: "WARD",
        requestedScopeId: makinaWard.id,
      },
    });
    const requestId = created.json().id as string;

    await api(app, {
      method: "POST",
      url: `/api/v1/users/access-requests/${requestId}/review`,
      cookie: admin.cookie,
      csrf: admin.csrf,
      payload: { action: "approve", roleCode: "WARD_OFFICER", scopeType: "WARD", scopeId: makinaWard.id },
    });

    const session = await login(app, "new.officer@makina.test", REQUEST_PASSWORD);
    expect(session.user?.mustChangePassword).toBe(true);

    const blocked = await api(app, {
      method: "GET",
      url: "/api/v1/staff",
      cookie: session.cookie,
    });
    expect(blocked.statusCode).toBe(403);

    const changed = await api(app, {
      method: "POST",
      url: "/api/v1/auth/change-password",
      cookie: session.cookie,
      csrf: session.csrf,
      payload: { currentPassword: REQUEST_PASSWORD, newPassword: "OfficerPass-123456" },
    });
    expect(changed.statusCode).toBe(200);

    const allowed = await api(app, {
      method: "GET",
      url: "/api/v1/staff",
      cookie: session.cookie,
    });
    expect(allowed.statusCode).toBe(200);
  });

  it("rate-limits public access requests per source IP", async () => {
    let lastStatus = 0;
    for (let i = 0; i < 21; i += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/users/access-requests",
        headers: { "x-forwarded-for": "203.0.113.9" },
        payload: {
          displayName: "Burst Requester",
          email: `burst.request.${i}@makina.test`,
          password: REQUEST_PASSWORD,
          reason: "Testing the public access request throttle",
          requestedScope: "WARD",
          requestedScopeId: makinaWard.id,
        },
      });
      lastStatus = response.statusCode;
    }
    expect(lastStatus).toBe(429);
  });
});
