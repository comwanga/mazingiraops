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

describe("auth flow (integration)", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await buildApp(testConfig(TEST_DB_URL));
  });

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetAuthData(prisma);
  });

  it("bootstraps a system owner exactly once via setup token", async () => {
    const response = await api(app, {
      method: "POST",
      url: "/api/v1/auth/bootstrap",
      payload: {
        setupToken: "test-setup-token",
        email: "owner@makina.test",
        password: "OwnerPass-123456",
        displayName: "Owner",
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().user.email).toBe("owner@makina.test");

    const duplicate = await api(app, {
      method: "POST",
      url: "/api/v1/auth/bootstrap",
      payload: {
        setupToken: "test-setup-token",
        email: "owner2@makina.test",
        password: "OwnerPass-123456",
      },
    });
    expect(duplicate.statusCode).toBe(409);

    const wrongToken = await api(app, {
      method: "POST",
      url: "/api/v1/auth/bootstrap",
      payload: {
        setupToken: "wrong-token",
        email: "owner3@makina.test",
        password: "OwnerPass-123456",
      },
    });
    expect(wrongToken.statusCode).toBe(403);
  });

  it("creates the deployment bootstrap admin once and requires a password change", async () => {
    const bootstrapConfig = {
      ...testConfig(TEST_DB_URL),
      bootstrapAdmin: {
        email: "bootstrap.admin@makina.test",
        password: "TemporaryAdmin-123",
        displayName: "Bootstrap Administrator",
      },
    };
    const bootstrapApp = await buildApp(bootstrapConfig);
    try {
      const session = await login(
        bootstrapApp,
        "bootstrap.admin@makina.test",
        "TemporaryAdmin-123",
      );
      expect(session.user?.mustChangePassword).toBe(true);

      const blocked = await api(bootstrapApp, {
        method: "GET",
        url: "/api/v1/dashboard",
        cookie: session.cookie,
      });
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json().error.message).toMatch(/Password change required/);

      const change = await api(bootstrapApp, {
        method: "POST",
        url: "/api/v1/auth/change-password",
        cookie: session.cookie,
        csrf: session.csrf,
        payload: {
          currentPassword: "TemporaryAdmin-123",
          newPassword: "PermanentAdmin-456",
        },
      });
      expect(change.statusCode).toBe(200);
    } finally {
      await bootstrapApp.close();
    }

    const restartedApp = await buildApp(bootstrapConfig);
    try {
      const temporary = await login(
        restartedApp,
        "bootstrap.admin@makina.test",
        "TemporaryAdmin-123",
      );
      expect(temporary.user).toBeUndefined();

      const permanent = await login(
        restartedApp,
        "bootstrap.admin@makina.test",
        "PermanentAdmin-456",
      );
      expect(permanent.user?.mustChangePassword).toBe(false);
      expect(
        await prisma.auditEvent.count({ where: { action: "AUTH.BOOTSTRAP_ENV" } }),
      ).toBe(1);
    } finally {
      await restartedApp.close();
    }
  });

  it("reconciles a matching pre-bootstrap admin exactly once", async () => {
    const county = await prisma.county.findUniqueOrThrow({ where: { code: "NCC" } });
    await createUserWithAssignment(prisma, {
      email: "bootstrap.admin@makina.test",
      password: "PreviousAdmin-123",
      displayName: "Previous Administrator",
      roleCode: "SYSTEM_ADMIN",
      scopeType: "COUNTY",
      scopeId: county.id,
    });
    const bootstrapConfig = {
      ...testConfig(TEST_DB_URL),
      bootstrapAdmin: {
        email: "bootstrap.admin@makina.test",
        password: "TemporaryAdmin-123",
        displayName: "Bootstrap Administrator",
      },
    };

    const reconciledApp = await buildApp(bootstrapConfig);
    try {
      const previous = await login(
        reconciledApp,
        "bootstrap.admin@makina.test",
        "PreviousAdmin-123",
      );
      expect(previous.user).toBeUndefined();

      const temporary = await login(
        reconciledApp,
        "bootstrap.admin@makina.test",
        "TemporaryAdmin-123",
      );
      expect(temporary.user?.mustChangePassword).toBe(true);
      expect(
        await prisma.auditEvent.count({ where: { action: "AUTH.BOOTSTRAP_ENV" } }),
      ).toBe(1);
    } finally {
      await reconciledApp.close();
    }
  });

  it("logs in, exposes me, logs out, and revokes the session", async () => {
    const session = await bootstrapAdmin(app);

    const me = await api(app, { method: "GET", url: "/api/v1/auth/me", cookie: session.cookie });
    expect(me.statusCode).toBe(200);
    const meBody = me.json();
    expect(meBody.user.email).toBe("admin@makina.test");
    expect(meBody.user.assignments).toHaveLength(1);
    expect(meBody.user.assignments[0].role).toBe("SYSTEM_ADMIN");
    expect(meBody.user.capabilities).toContain("USERS_MANAGE");
    expect(typeof meBody.user.csrfToken).toBe("string");

    const unauthenticated = await api(app, { method: "GET", url: "/api/v1/auth/me" });
    expect(unauthenticated.statusCode).toBe(401);

    const logout = await api(app, {
      method: "POST",
      url: "/api/v1/auth/logout",
      cookie: session.cookie,
      csrf: session.csrf,
    });
    expect(logout.statusCode).toBe(200);

    const afterLogout = await api(app, { method: "GET", url: "/api/v1/auth/me", cookie: session.cookie });
    expect(afterLogout.statusCode).toBe(401);
  });

  it("rejects bad credentials and a disabled account", async () => {
    await bootstrapAdmin(app);
    const bad = await login(app, "admin@makina.test", "wrong-password");
    expect(bad.user).toBeUndefined();

    const disabledUser = await prisma.user.findUnique({ where: { email: "admin@makina.test" } });
    await prisma.user.update({ where: { id: disabledUser!.id }, data: { active: false } });
    const disabled = await login(app, "admin@makina.test", "AdminOnly-123");
    expect(disabled.user).toBeUndefined();
  });

  it("requires the CSRF header for session mutations", async () => {
    const session = await bootstrapAdmin(app);
    const noCsrf = await api(app, {
      method: "POST",
      url: "/api/v1/auth/logout",
      cookie: session.cookie,
    });
    expect(noCsrf.statusCode).toBe(403);
  });

  it("changes the password and invalidates other sessions", async () => {
    const session = await bootstrapAdmin(app);
    const second = await login(app, "admin@makina.test", "AdminOnly-123");

    const change = await api(app, {
      method: "POST",
      url: "/api/v1/auth/change-password",
      cookie: session.cookie,
      csrf: session.csrf,
      payload: {
        currentPassword: "AdminOnly-123",
        newPassword: "NewPassword-456",
      },
    });
    expect(change.statusCode).toBe(200);

    const oldPasswordFails = await login(app, "admin@makina.test", "AdminOnly-123");
    expect(oldPasswordFails.user).toBeUndefined();

    const newPasswordWorks = await login(app, "admin@makina.test", "NewPassword-456");
    expect(newPasswordWorks.user).toBeDefined();

    const secondSessionRevoked = await api(app, {
      method: "GET",
      url: "/api/v1/auth/me",
      cookie: second.cookie,
    });
    expect(secondSessionRevoked.statusCode).toBe(401);
  });

  it("throttles repeated failed logins", async () => {
    await bootstrapAdmin(app);
    let lastStatus = 0;
    for (let i = 0; i < 6; i += 1) {
      const response = await api(app, {
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "throttle-user@makina.test", password: "wrong-password" },
      });
      lastStatus = response.statusCode;
    }
    expect(lastStatus).toBe(429);
  });

  it("records audit events for auth actions", async () => {
    await bootstrapAdmin(app);
    const loginCount = await prisma.auditEvent.count({ where: { action: "AUTH.LOGIN" } });
    expect(loginCount).toBeGreaterThanOrEqual(1);
    const bootstrapCount = await prisma.auditEvent.count({ where: { action: "AUTH.BOOTSTRAP" } });
    expect(bootstrapCount).toBeGreaterThanOrEqual(1);
  });

  it("rate-limits owner bootstrap per source IP", async () => {
    let lastStatus = 0;
    for (let i = 0; i < 21; i += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/bootstrap",
        headers: { "x-forwarded-for": "198.51.100.7" },
        payload: {
          setupToken: "wrong-token",
          email: `burst-${i}@makina.test`,
          password: "OwnerPass-123456",
        },
      });
      lastStatus = response.statusCode;
    }
    expect(lastStatus).toBe(429);
  });

  it("exposes health endpoints without authentication", async () => {
    const live = await api(app, { method: "GET", url: "/health/live" });
    expect(live.statusCode).toBe(200);
    expect(live.json().status).toBe("ok");

    const ready = await api(app, { method: "GET", url: "/health/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().status).toBe("ready");
  });
});
