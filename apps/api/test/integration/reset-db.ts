import { execFileSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@ward-ops/database";

const REPO_ROOT = path.resolve(process.cwd(), "../..");
const PRISMA_CLI = path.join(
  REPO_ROOT,
  "packages/database/node_modules/prisma/build/index.js",
);
const PRISMA_SCHEMA = path.join(REPO_ROOT, "packages/database/prisma/schema.prisma");
const TSX_CLI = path.join(REPO_ROOT, "packages/database/node_modules/tsx/dist/cli.mjs");
const DATABASE_SEED = path.join(REPO_ROOT, "packages/database/src/seed.ts");

function runNode(script: string, args: string[], databaseUrl: string): void {
  execFileSync(process.execPath, [script, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });
}

/**
 * Rebuilds the test database: applies migrations, seeds reference data,
 * clears dynamic records and adds Mombasa/Likoni as an out-of-county scope
 * used by tenancy tests. Nairobi's complete hierarchy comes from the seed.
 */
export async function resetDatabase(databaseUrl: string): Promise<void> {
  process.env.DATABASE_URL = databaseUrl;
  runNode(PRISMA_CLI, ["migrate", "deploy", "--schema", PRISMA_SCHEMA], databaseUrl);

  const prisma = new PrismaClient();
  try {
    await prisma.$transaction([
      prisma.legacyMigration.deleteMany(),
      prisma.reportEvidence.deleteMany(),
      prisma.evidence.deleteMany(),
      prisma.report.deleteMany(),
      prisma.reminderDelivery.deleteMany(),
      prisma.workLogOperations.deleteMany(),
      prisma.workLogDetail.deleteMany(),
      prisma.workLog.deleteMany(),
      prisma.attendance.deleteMany(),
      prisma.attendanceSession.deleteMany(),
      prisma.absenceRequest.deleteMany(),
      prisma.documentClassification.deleteMany(),
      prisma.document.deleteMany(),
      prisma.employeeAssignment.deleteMany(),
      prisma.employeeProfile.deleteMany(),
      prisma.employee.deleteMany(),
      prisma.assignment.deleteMany(),
      prisma.userCapability.deleteMany(),
      prisma.roleCapability.deleteMany(),
      prisma.userSession.deleteMany(),
      prisma.accessRequest.deleteMany(),
      prisma.auditEvent.deleteMany(),
      prisma.user.deleteMany(),
    ]);
    await prisma.role.updateMany({ data: { permissionsManagedAt: null } });

    // Reference data (capabilities, roles, role capabilities, county ->
    // subcounty -> ward) is rebuilt after the deletes so a fresh, complete
    // dataset is guaranteed.
    runNode(TSX_CLI, [DATABASE_SEED], databaseUrl);

    const mombasa = await prisma.county.upsert({
      where: { code: "MOMBASA" },
      update: {},
      create: { code: "MOMBASA", name: "Mombasa County" },
    });

    const likoni = await prisma.subcounty.upsert({
      where: { code: "LIKONI" },
      update: {},
      create: { code: "LIKONI", name: "Likoni", countyId: mombasa.id },
    });
    await prisma.ward.upsert({
      where: { code: "LIKONI_WARD" },
      update: {},
      create: { code: "LIKONI_WARD", name: "Likoni Ward", subcountyId: likoni.id },
    });
  } finally {
    await prisma.$disconnect();
  }
}
