import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PrismaClient } from "@ward-ops/database";
import { testConfig } from "./test-config";
import {
  api,
  buildApp,
  createEmployee,
  createUserWithAssignment,
  login,
  resetAuthData,
} from "./test-utils";

const TEST_DB_URL = process.env.TEST_DATABASE_URL!;
const PASSWORD = "TestPass-123456";

function multipartRoster(wardId: string, name: string, data: Buffer): { body: Buffer; contentType: string } {
  const boundary = `----wardops${Math.random().toString(36).slice(2)}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="wardId"\r\n\r\n${wardId}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: text/csv\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

describe("staff management (integration)", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaClient;

  let makinaWard: { id: string; code: string };
  let woodleyWard: { id: string; code: string };
  let nccCounty: { id: string };

  let officer: { cookie: string | null; csrf: string | null };
  let countyOperator: { cookie: string | null; csrf: string | null };

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await buildApp(testConfig(TEST_DB_URL));
    makinaWard = await prisma.ward.findUniqueOrThrow({ where: { code: "MAKINA" } });
    woodleyWard = await prisma.ward.findUniqueOrThrow({ where: { code: "WOODLEY" } });
    nccCounty = await prisma.county.findUniqueOrThrow({ where: { code: "NCC" } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetAuthData(prisma);
    await prisma.reminderDelivery.deleteMany();
    await prisma.documentClassification.deleteMany();
    await prisma.document.deleteMany();
    await prisma.absenceRequest.deleteMany();
    await prisma.employeeProfile.deleteMany();
    await prisma.employee.deleteMany();
    const officerUserId = await createUserWithAssignment(prisma, {
      email: "officer@makina.test",
      password: PASSWORD,
      displayName: "Ward Officer",
      roleCode: "WARD_OFFICER",
      scopeType: "WARD",
      scopeId: makinaWard.id,
    });
    officer = await login(app, "officer@makina.test", PASSWORD);
    expect(officer.user).toBeDefined();
    expect(officer.cookie).toBeTruthy();

    const countyOperatorId = await createUserWithAssignment(prisma, {
      email: "county.operator@makina.test",
      password: PASSWORD,
      displayName: "County Staff Operator",
      roleCode: "WARD_OFFICER",
      scopeType: "COUNTY",
      scopeId: nccCounty.id,
    });
    countyOperator = await login(app, "county.operator@makina.test", PASSWORD);
    expect(countyOperator.cookie).toBeTruthy();
    void officerUserId;
    void countyOperatorId;
  });

  it("creates staff in the assigned ward", async () => {
    const response = await api(app, {
      method: "POST",
      url: "/api/v1/staff",
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload: {
        employeeNumber: "20250100001",
        fullName: "Amina Hassan",
        phone: "0711000001",
        email: "amina@makina.test",
        designation: "Green Army Staff",
        wardId: makinaWard.id,
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.employeeNumber).toBe("20250100001");
    expect(body.ward.id).toBe(makinaWard.id);
    expect(body.profile.rosterStatus).toBe("ON_DUTY");

    const audit = await prisma.auditEvent.count({
      where: { action: "EMPLOYEE.CREATED" },
    });
    expect(audit).toBeGreaterThanOrEqual(1);
  });

  it("rejects duplicate employee numbers and phones", async () => {
    const payload = {
      employeeNumber: "20250100002",
      fullName: "Brian Otieno",
      phone: "0711000002",
      wardId: makinaWard.id,
    };
    await api(app, {
      method: "POST",
      url: "/api/v1/staff",
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload,
    });

    const duplicateNumber = await api(app, {
      method: "POST",
      url: "/api/v1/staff",
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload: { ...payload, phone: "0711999999" },
    });
    expect(duplicateNumber.statusCode).toBe(409);

    const duplicatePhone = await api(app, {
      method: "POST",
      url: "/api/v1/staff",
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload: { ...payload, employeeNumber: "20250100003" },
    });
    expect(duplicatePhone.statusCode).toBe(409);
  });

  it("cannot create staff in another ward", async () => {
    const response = await api(app, {
      method: "POST",
      url: "/api/v1/staff",
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload: {
        employeeNumber: "20250100004",
        fullName: "Cross Ward",
        phone: "0711000004",
        wardId: woodleyWard.id,
      },
    });
    expect(response.statusCode).toBe(403);
  });

  it("lists only staff within the officer's ward", async () => {
    await createEmployee(prisma, {
      employeeNumber: "20250100010",
      fullName: "Makina Staff",
      phone: "0712000010",
      wardId: makinaWard.id,
    });
    await createEmployee(prisma, {
      employeeNumber: "20250100011",
      fullName: "Woodley Staff",
      phone: "0712000011",
      wardId: woodleyWard.id,
    });

    const response = await api(app, {
      method: "GET",
      url: "/api/v1/staff",
      cookie: officer.cookie,
    });
    expect(response.statusCode).toBe(200);
    const list = response.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list).toHaveLength(1);
    expect(list[0].employeeNumber).toBe("20250100010");
  });

  it("blocks reading another ward's employee", async () => {
    const woodleyEmployeeId = await createEmployee(prisma, {
      employeeNumber: "20250100012",
      fullName: "Woodley Staff",
      phone: "0712000012",
      wardId: woodleyWard.id,
    });
    const response = await api(app, {
      method: "GET",
      url: `/api/v1/staff/${woodleyEmployeeId}`,
      cookie: officer.cookie,
    });
    expect(response.statusCode).toBe(403);
  });

  it("updates, deactivates and reactivates staff", async () => {
    const employeeId = await createEmployee(prisma, {
      employeeNumber: "20250100013",
      fullName: "Updateable Staff",
      phone: "0712000013",
      wardId: makinaWard.id,
    });

    const updated = await api(app, {
      method: "PATCH",
      url: `/api/v1/staff/${employeeId}`,
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload: { employeeNumber: "20250100099", fullName: "Updated Name", residence: "Makina", rosterStatus: "ANNUAL_LEAVE" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().employeeNumber).toBe("20250100099");
    expect(updated.json().fullName).toBe("Updated Name");
    expect(updated.json().profile.residence).toBe("Makina");
    expect(updated.json().profile.rosterStatus).toBe("ANNUAL_LEAVE");

    const returned = await api(app, {
      method: "PATCH",
      url: `/api/v1/staff/${employeeId}`,
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload: { rosterStatus: "ON_DUTY" },
    });
    expect(returned.statusCode).toBe(200);
    expect(returned.json().profile.rosterStatus).toBe("ON_DUTY");

    const deactivated = await api(app, {
      method: "POST",
      url: `/api/v1/staff/${employeeId}/deactivate`,
      cookie: officer.cookie,
      csrf: officer.csrf,
    });
    expect(deactivated.statusCode).toBe(200);
    expect(deactivated.json().active).toBe(false);

    const reactivated = await api(app, {
      method: "POST",
      url: `/api/v1/staff/${employeeId}/reactivate`,
      cookie: officer.cookie,
      csrf: officer.csrf,
    });
    expect(reactivated.statusCode).toBe(200);
    expect(reactivated.json().active).toBe(true);
  });

  it("assigns staff to another ward within a county scope", async () => {
    const employeeId = await createEmployee(prisma, {
      employeeNumber: "20250100014",
      fullName: "Assignable Staff",
      phone: "0712000014",
      wardId: makinaWard.id,
    });

    const response = await api(app, {
      method: "POST",
      url: `/api/v1/staff/${employeeId}/assignments`,
      cookie: countyOperator.cookie,
      csrf: countyOperator.csrf,
      payload: { wardId: woodleyWard.id },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.assignments.some((a: { wardId: string }) => a.wardId === woodleyWard.id)).toBe(true);
  });

  it("rejects duplicate assignment and assignment to home ward", async () => {
    const employeeId = await createEmployee(prisma, {
      employeeNumber: "20250100015",
      fullName: "Duplicate Assign",
      phone: "0712000015",
      wardId: makinaWard.id,
    });

    const toHome = await api(app, {
      method: "POST",
      url: `/api/v1/staff/${employeeId}/assignments`,
      cookie: countyOperator.cookie,
      csrf: countyOperator.csrf,
      payload: { wardId: makinaWard.id },
    });
    expect(toHome.statusCode).toBe(409);

    await api(app, {
      method: "POST",
      url: `/api/v1/staff/${employeeId}/assignments`,
      cookie: countyOperator.cookie,
      csrf: countyOperator.csrf,
      payload: { wardId: woodleyWard.id },
    });
    const duplicate = await api(app, {
      method: "POST",
      url: `/api/v1/staff/${employeeId}/assignments`,
      cookie: countyOperator.cookie,
      csrf: countyOperator.csrf,
      payload: { wardId: woodleyWard.id },
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it("distinguishes a permanent transfer from a temporary assignment", async () => {
    const employeeId = await createEmployee(prisma, {
      employeeNumber: "20250100018",
      fullName: "Transfer Staff",
      phone: "0712000018",
      wardId: makinaWard.id,
    });
    const temporary = await api(app, {
      method: "POST",
      url: `/api/v1/staff/${employeeId}/assignments`,
      cookie: countyOperator.cookie,
      csrf: countyOperator.csrf,
      payload: { wardId: woodleyWard.id, type: "TEMPORARY" },
    });
    expect(temporary.statusCode).toBe(201);
    expect(temporary.json().wardId).toBe(makinaWard.id);

    const transferred = await api(app, {
      method: "POST",
      url: `/api/v1/staff/${employeeId}/assignments`,
      cookie: countyOperator.cookie,
      csrf: countyOperator.csrf,
      payload: { wardId: woodleyWard.id, type: "TRANSFER" },
    });
    expect(transferred.statusCode).toBe(201);
    expect(transferred.json().wardId).toBe(woodleyWard.id);
    expect(transferred.json().assignments).toEqual([]);
    const history = await prisma.employeeAssignment.findMany({
      where: { employeeId, kind: "PRIMARY" },
      orderBy: { assignedAt: "asc" },
    });
    expect(history).toHaveLength(2);
    expect(history[0]).toEqual(expect.objectContaining({ wardId: makinaWard.id, endedAt: expect.any(Date) }));
    expect(history[1]).toEqual(expect.objectContaining({ wardId: woodleyWard.id, endedAt: null }));
  });

  it("previews and commits CSV imports with row results and history", async () => {
    const csv = Buffer.from([
      "Employee ID,Full Name,Phone Number,Status,Residence",
      "20250100019,Import One,0712000019,On duty,Makina",
      "20250100020,Duplicate Phone,0712000019,On duty,Makina",
    ].join("\n"));
    const upload = multipartRoster(makinaWard.id, "staff.csv", csv);
    const preview = await app.inject({
      method: "POST",
      url: "/api/v1/staff/imports/preview",
      headers: {
        cookie: officer.cookie!,
        "x-csrf-token": officer.csrf!,
        "content-type": upload.contentType,
      },
      payload: upload.body,
    });
    expect(preview.statusCode).toBe(201);
    expect(preview.json().rows.map((row: { status: string }) => row.status)).toEqual([
      "CREATE",
      "DUPLICATE_FILE",
    ]);

    const commit = await api(app, {
      method: "POST",
      url: "/api/v1/staff/imports/commit",
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload: {
        wardId: makinaWard.id,
        sourceName: "staff.csv",
        duplicateStrategy: "SKIP",
        rows: [preview.json().rows[0].value],
      },
    });
    expect(commit.statusCode).toBe(201);
    expect(commit.json().rows[0].status).toBe("CREATE");

    const history = await api(app, {
      method: "GET",
      url: "/api/v1/staff/imports/history",
      cookie: officer.cookie,
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().items[0].targetId).toBe(commit.json().importId);
  });

  it("requires STAFF_MANAGE for mutations", async () => {
    const response = await api(app, {
      method: "POST",
      url: "/api/v1/staff",
      payload: {
        employeeNumber: "20250100016",
        fullName: "No Permission",
        phone: "0712000016",
        wardId: makinaWard.id,
      },
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects malformed input with 422 instead of 500", async () => {
    const badWard = await api(app, {
      method: "POST",
      url: "/api/v1/staff",
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload: {
        employeeNumber: "20250100017",
        fullName: "Bad Ward",
        phone: "0712000017",
        wardId: "not-a-cuid",
      },
    });
    expect(badWard.statusCode).toBe(422);
    expect(badWard.json().error.code).toBe("VALIDATION_FAILED");

    const badPhone = await api(app, {
      method: "POST",
      url: "/api/v1/staff",
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload: {
        employeeNumber: "20250100017",
        fullName: "Bad Phone",
        phone: "not-a-phone",
        wardId: makinaWard.id,
      },
    });
    expect(badPhone.statusCode).toBe(422);
  });
});
