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

describe("cross-tenant isolation (integration)", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaClient;

  let makinaWard: { id: string; code: string };
  let woodleyWard: { id: string; code: string };
  let likoniWard: { id: string; code: string };
  let kibraSubcounty: { id: string };
  let nccCounty: { id: string };
  let mombasaCounty: { id: string };

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await buildApp(testConfig(TEST_DB_URL));

    makinaWard = await prisma.ward.findUniqueOrThrow({ where: { code: "MAKINA" } });
    woodleyWard = await prisma.ward.findUniqueOrThrow({ where: { code: "WOODLEY" } });
    likoniWard = await prisma.ward.findUniqueOrThrow({ where: { code: "LIKONI_WARD" } });
    kibraSubcounty = await prisma.subcounty.findUniqueOrThrow({ where: { code: "KIBRA" } });
    nccCounty = await prisma.county.findUniqueOrThrow({ where: { code: "NCC" } });
    mombasaCounty = await prisma.county.findUniqueOrThrow({ where: { code: "MOMBASA" } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetAuthData(prisma);
    await createUserWithAssignment(prisma, {
      email: "makina.officer@makina.test",
      password: PASSWORD,
      displayName: "Makina Officer",
      roleCode: "WARD_OFFICER",
      scopeType: "WARD",
      scopeId: makinaWard.id,
    });
    await createUserWithAssignment(prisma, {
      email: "kibra.reviewer@makina.test",
      password: PASSWORD,
      displayName: "Kibra Reviewer",
      roleCode: "SUBCOUNTY_REVIEWER",
      scopeType: "SUBCOUNTY",
      scopeId: kibraSubcounty.id,
    });
    await createUserWithAssignment(prisma, {
      email: "ncc.admin@makina.test",
      password: PASSWORD,
      displayName: "NCC Admin",
      roleCode: "SYSTEM_ADMIN",
      scopeType: "COUNTY",
      scopeId: nccCounty.id,
    });
    await createUserWithAssignment(prisma, {
      email: "mombasa.admin@makina.test",
      password: PASSWORD,
      displayName: "Mombasa Admin",
      roleCode: "SYSTEM_ADMIN",
      scopeType: "COUNTY",
      scopeId: mombasaCounty.id,
    });
  });

  it("Makina officer CANNOT read another ward's data", async () => {
    const session = await login(app, "makina.officer@makina.test", PASSWORD);

    const wards = await api(app, {
      method: "GET",
      url: "/api/v1/organisations/wards",
      cookie: session.cookie,
    });
    expect(wards.statusCode).toBe(200);
    const wardCodes = wards.json().wards.map((ward: { code: string }) => ward.code);
    expect(wardCodes).toEqual(["MAKINA"]);

    const ownWard = await api(app, {
      method: "GET",
      url: `/api/v1/wards/${makinaWard.id}`,
      cookie: session.cookie,
    });
    expect(ownWard.statusCode).toBe(200);

    const otherWard = await api(app, {
      method: "GET",
      url: `/api/v1/wards/${woodleyWard.id}`,
      cookie: session.cookie,
    });
    expect(otherWard.statusCode).toBe(404);

    const anotherCountyWard = await api(app, {
      method: "GET",
      url: `/api/v1/wards/${likoniWard.id}`,
      cookie: session.cookie,
    });
    expect(anotherCountyWard.statusCode).toBe(404);
  });

  it("Ward officer CANNOT escalate scope through request parameters", async () => {
    const session = await login(app, "makina.officer@makina.test", PASSWORD);

    const withParam = await api(app, {
      method: "GET",
      url: `/api/v1/organisations/wards?subcountyId=${kibraSubcounty.id}&wardId=${woodleyWard.id}`,
      cookie: session.cookie,
    });
    const codes = withParam.json().wards.map((ward: { code: string }) => ward.code);
    expect(codes).toEqual(["MAKINA"]);

    const escalated = await api(app, {
      method: "GET",
      url: `/api/v1/wards/${woodleyWard.id}?subcountyId=${kibraSubcounty.id}`,
      cookie: session.cookie,
    });
    expect(escalated.statusCode).toBe(404);
  });

  it("Subcounty reviewer CAN access authorized wards and nothing else", async () => {
    const session = await login(app, "kibra.reviewer@makina.test", PASSWORD);

    const wards = await api(app, {
      method: "GET",
      url: "/api/v1/organisations/wards",
      cookie: session.cookie,
    });
    const wardCodes = wards.json().wards.map((ward: { code: string }) => ward.code);
    expect(wardCodes).toHaveLength(5);
    expect(wardCodes).toEqual(expect.arrayContaining([
      "LAINI_SABA", "LINDI", "MAKINA", "WOODLEY", "SARANGOMBE",
    ]));

    const makina = await api(app, {
      method: "GET",
      url: `/api/v1/wards/${makinaWard.id}`,
      cookie: session.cookie,
    });
    expect(makina.statusCode).toBe(200);

    const woodley = await api(app, {
      method: "GET",
      url: `/api/v1/wards/${woodleyWard.id}`,
      cookie: session.cookie,
    });
    expect(woodley.statusCode).toBe(200);

    const outsideSubcounty = await api(app, {
      method: "GET",
      url: `/api/v1/wards/${likoniWard.id}`,
      cookie: session.cookie,
    });
    expect(outsideSubcounty.statusCode).toBe(404);
  });

  it("County-level user CAN access only the assigned county scope", async () => {
    const ncc = await login(app, "ncc.admin@makina.test", PASSWORD);
    const nccWards = await api(app, {
      method: "GET",
      url: "/api/v1/organisations/wards",
      cookie: ncc.cookie,
    });
    const nccCodes = nccWards.json().wards.map((ward: { code: string }) => ward.code).sort();
    expect(nccCodes).toHaveLength(85);
    expect(nccCodes).toEqual(expect.arrayContaining(["MAKINA", "WOODLEY"]));

    const nccOutside = await api(app, {
      method: "GET",
      url: `/api/v1/wards/${likoniWard.id}`,
      cookie: ncc.cookie,
    });
    expect(nccOutside.statusCode).toBe(404);

    const mombasa = await login(app, "mombasa.admin@makina.test", PASSWORD);
    const mombasaWards = await api(app, {
      method: "GET",
      url: "/api/v1/organisations/wards",
      cookie: mombasa.cookie,
    });
    const mombasaCodes = mombasaWards.json().wards.map((ward: { code: string }) => ward.code);
    expect(mombasaCodes).toEqual(["LIKONI_WARD"]);

    const mombasaOutside = await api(app, {
      method: "GET",
      url: `/api/v1/wards/${makinaWard.id}`,
      cookie: mombasa.cookie,
    });
    expect(mombasaOutside.statusCode).toBe(404);
  });

  it("organisation tree is scoped to the user's assignments", async () => {
    const session = await login(app, "makina.officer@makina.test", PASSWORD);
    const tree = await api(app, {
      method: "GET",
      url: "/api/v1/organisations",
      cookie: session.cookie,
    });
    const counties = tree.json().counties;
    expect(counties).toHaveLength(1);
    expect(counties[0].code).toBe("NCC");
    const wardCodes = counties[0].subcounties.flatMap((subcounty: { wards: Array<{ code: string }> }) =>
      subcounty.wards.map((ward) => ward.code),
    );
    expect(wardCodes).toEqual(["MAKINA"]);
  });

  it("persists Nairobi's complete hierarchy and identifies a ward officer by role and lineage", async () => {
    const publicTree = await api(app, {
      method: "GET",
      url: "/api/v1/organisations/public",
    });
    expect(publicTree.statusCode).toBe(200);
    const nairobi = publicTree.json().counties.find(
      (county: { code: string }) => county.code === "NCC",
    );
    expect(nairobi.subcounties).toHaveLength(17);
    expect(
      nairobi.subcounties.flatMap(
        (subcounty: { wards: Array<{ code: string }> }) => subcounty.wards,
      ),
    ).toHaveLength(85);
    const kibra = nairobi.subcounties.find(
      (subcounty: { code: string }) => subcounty.code === "KIBRA",
    );
    expect(kibra.wards.map((ward: { code: string }) => ward.code)).toEqual(
      expect.arrayContaining(["MAKINA", "WOODLEY"]),
    );

    const session = await login(app, "makina.officer@makina.test", PASSWORD);
    const me = await api(app, {
      method: "GET",
      url: "/api/v1/auth/me",
      cookie: session.cookie,
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.assignments[0]).toEqual(expect.objectContaining({
      role: "WARD_OFFICER",
      roleName: "ward officer",
      scopeType: "WARD",
      wardName: "Makina",
      subcountyName: "Kibra",
      countyName: null,
    }));
  });
});
