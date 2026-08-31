import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@ward-ops/database";
import { LocalObjectStorage } from "../../dist/storage/object-storage.service";
import { readLegacyDatabase } from "../../dist/migration/legacy-db";
import { LegacyMigrator } from "../../dist/migration/migrator";

const require = createRequire(import.meta.url);

function sha256Hex(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function appConfig(documentStoreDir: string) {
  return {
    env: "test",
    port: 0,
    databaseUrl: process.env.TEST_DATABASE_URL!,
    redis: { configured: false, connectTimeoutMs: 2_000, dashboardTtlSeconds: 120 },
    publicBaseUrl: "http://localhost:3000",
    sessionHours: 12,
    secureCookies: false,
    storage: { region: "us-east-1", forcePathStyle: false, configured: false },
    ownerSetupToken: "token",
    smtp: { port: 587, from: "x@y.z", configured: false },
    ai: { enabled: false, baseUrl: "", model: "" },
    maxUploadBytes: 1024 * 1024,
    documentStoreDir,
  };
}

describe("legacy database migration (integration)", () => {
  const prisma = new PrismaClient();
  let workDir: string;
  let legacyRoot: string;
  let storageRoot: string;
  let storage: LocalObjectStorage;

  beforeAll(async () => {
    workDir = await mkdtemp(path.join(os.tmpdir(), "migrate-int-"));
    legacyRoot = path.join(workDir, "legacy");
    storageRoot = path.join(workDir, "storage");
    await mkdir(legacyRoot);
    storage = new LocalObjectStorage(appConfig(storageRoot) as never);
  });

  beforeEach(async () => {
    await cleanupMigratedData();
    await rm(storageRoot, { recursive: true, force: true });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await rm(workDir, { recursive: true, force: true });
  });

  async function cleanupMigratedData(): Promise<void> {
    await prisma.$transaction([
      prisma.reportEvidence.deleteMany(),
      prisma.evidence.deleteMany(),
      prisma.report.deleteMany(),
      prisma.workLogOperations.deleteMany(),
      prisma.workLogDetail.deleteMany(),
      prisma.workLog.deleteMany(),
      prisma.documentClassification.deleteMany(),
      prisma.document.deleteMany(),
      prisma.reminderDelivery.deleteMany(),
      prisma.absenceRequest.deleteMany(),
      prisma.attendance.deleteMany(),
      prisma.attendanceSession.deleteMany(),
      prisma.employeeAssignment.deleteMany(),
      prisma.employeeProfile.deleteMany(),
      prisma.employee.deleteMany(),
      prisma.assignment.deleteMany(),
      prisma.userSession.deleteMany(),
      prisma.accessRequest.deleteMany(),
      prisma.auditEvent.deleteMany(),
      prisma.userCapability.deleteMany(),
      prisma.legacyMigration.deleteMany(),
      prisma.user.deleteMany(),
    ]);
  }

  it("migrates a synthetic legacy database end-to-end", async () => {
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const dbPath = path.join(workDir, "synthetic.db");
    const db = new DatabaseSync(dbPath);

    const photo1 = "legacy-photo-before";
    const photo2 = "legacy-photo-field";
    const photo3 = "legacy-photo-after";
    const doc1 = "legacy-doc-1";
    await writeFile(path.join(legacyRoot, photo1), photo1);
    await writeFile(path.join(legacyRoot, photo2), photo2);
    await writeFile(path.join(legacyRoot, photo3), photo3);
    await writeFile(path.join(legacyRoot, doc1), doc1);

    const snapshot = JSON.stringify({
      work_logs: [
        {
          id: 1,
          activity: "Market clean-up",
          completion_status: "incomplete",
          photos: [
            { id: 1, stage: "before", caption: "Before works", sha256: sha256Hex(photo1) },
            { id: 2, stage: "field", caption: "During works", sha256: sha256Hex(photo2) },
          ],
        },
      ],
    });

    db.exec(`
      CREATE TABLE employees (id INTEGER PRIMARY KEY, employee_number TEXT, full_name TEXT, phone TEXT, email TEXT, role TEXT, active INTEGER);
      CREATE TABLE employee_profiles (id INTEGER PRIMARY KEY, employee_id INTEGER, residence TEXT, roster_status TEXT, updated_at TEXT);
      CREATE TABLE attendance_sessions (id INTEGER PRIMARY KEY, token TEXT, work_date TEXT, activity TEXT, location TEXT, opens_at TEXT, closes_at TEXT, created_at TEXT);
      CREATE TABLE attendance (id INTEGER PRIMARY KEY, employee_id INTEGER, session_id INTEGER, work_date TEXT, checked_at TEXT, status TEXT, latitude REAL, longitude REAL);
      CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, display_name TEXT, password_hash TEXT, role TEXT, permissions TEXT, active INTEGER, must_change_password INTEGER, created_at TEXT);
      CREATE TABLE user_sessions (id INTEGER PRIMARY KEY, user_id INTEGER, token_hash TEXT, csrf_token TEXT, created_at TEXT, expires_at TEXT, last_seen_at TEXT, revoked_at TEXT);
      CREATE TABLE access_requests (id INTEGER PRIMARY KEY, display_name TEXT, email TEXT, password_hash TEXT, reason TEXT, status TEXT, created_at TEXT, reviewed_by INTEGER, reviewed_at TEXT, review_note TEXT, requested_scope TEXT, target_user_id INTEGER);
      CREATE TABLE absence_requests (id INTEGER PRIMARY KEY, employee_id INTEGER, kind TEXT, start_date TEXT, end_date TEXT, return_date TEXT, reason TEXT, status TEXT, submitted_by INTEGER, reviewed_by INTEGER, review_note TEXT, created_at TEXT, reviewed_at TEXT);
      CREATE TABLE absences (id INTEGER PRIMARY KEY, employee_id INTEGER, kind TEXT, start_date TEXT, end_date TEXT, return_date TEXT, reason TEXT, attachment_name TEXT, approval_status TEXT);
      CREATE TABLE planned_leave (id INTEGER PRIMARY KEY, employee_id INTEGER, leave_type TEXT, start_date TEXT, end_date TEXT, return_date TEXT, status TEXT, reminder_sent_at TEXT);
      CREATE TABLE documents (id INTEGER PRIMARY KEY, absence_request_id INTEGER, storage_key TEXT, original_filename TEXT, content_type TEXT, size_bytes INTEGER, sha256 TEXT, sensitivity TEXT, uploaded_by INTEGER, uploaded_at TEXT);
      CREATE TABLE document_classifications (id INTEGER PRIMARY KEY, document_id INTEGER, category TEXT);
      CREATE TABLE work_logs (id INTEGER PRIMARY KEY, work_date TEXT, activity TEXT, location TEXT, description TEXT, quantity REAL, unit TEXT, staff_count INTEGER, challenges TEXT, status TEXT, submitted_by INTEGER, reviewed_by INTEGER, review_note TEXT, created_at TEXT, reviewed_at TEXT);
      CREATE TABLE work_log_details (id INTEGER PRIMARY KEY, work_log_id INTEGER, completion_status TEXT, outstanding_work TEXT);
      CREATE TABLE work_log_operations (id INTEGER PRIMARY KEY, work_log_id INTEGER, areas_roads TEXT, number_of_trips INTEGER, waste_transfer_involved INTEGER, truck_id TEXT, backhoe_id TEXT, cleanup_done INTEGER, cleanup_stakeholders TEXT, climate_team_count INTEGER);
      CREATE TABLE work_photos (id INTEGER PRIMARY KEY, work_log_id INTEGER, storage_key TEXT, original_filename TEXT, content_type TEXT, size_bytes INTEGER, sha256 TEXT, caption TEXT, uploaded_by INTEGER, uploaded_at TEXT);
      CREATE TABLE work_photo_stages (id INTEGER PRIMARY KEY, photo_id INTEGER, stage TEXT);
      CREATE TABLE report_records (id INTEGER PRIMARY KEY, kind TEXT, start_date TEXT, end_date TEXT, status TEXT, title TEXT, narrative TEXT, snapshot_json TEXT, created_by INTEGER, created_at TEXT);
      CREATE TABLE reminder_deliveries (id INTEGER PRIMARY KEY, absence_request_id INTEGER, reminder_days INTEGER, recipient TEXT, status TEXT, message TEXT, created_at TEXT, sent_at TEXT);
      CREATE TABLE audit_events (id INTEGER PRIMARY KEY, occurred_at TEXT, actor_user_id INTEGER, action TEXT, target_type TEXT, target_id TEXT, details TEXT, source_ip TEXT);

      INSERT INTO users VALUES
        (1, 'admin@makina.legacy', 'System Admin', 'scrypt$legacyhash', 'system_admin', 'audit,attendance,reports', 1, 1, '2026-08-01 08:00:00'),
        (2, 'officer@makina.legacy', 'Ward Officer', 'scrypt$legacyhash2', 'ward_officer', 'attendance,reports', 1, 0, '2026-08-01 08:00:00'),
        (3, 'readonly@makina.legacy', 'Read Only', 'scrypt$legacyhash3', 'read_only', 'reports', 1, 0, '2026-08-01 08:00:00');

      INSERT INTO user_sessions VALUES
        (1, 1, 'token-hash-1', 'csrf-1', '2026-08-10 08:00:00', '2026-08-11 08:00:00', '2026-08-10 08:00:00', NULL);

      INSERT INTO employees VALUES
        (1, 'NCC-1042', 'Amina Wanjiku', '0712345601', 'amina@example.com', 'Team Leader', 1),
        (2, 'NCC-1043', 'Brian Otieno', '0712345602', 'brian@example.com', 'Green Army Staff', 1),
        (3, 'NCC-1044', 'Carol Mwende', '0712345603', 'carol@example.com', 'Green Army Staff', 0);
      INSERT INTO employee_profiles VALUES
        (1, 1, 'County House', 'on_duty', '2026-08-01 09:00:00'),
        (2, 2, NULL, 'annual_leave', '2026-08-01 09:00:00');

      INSERT INTO attendance_sessions VALUES
        (1, 'tok-1', '2026-08-10', 'Market clean-up', 'Makina Market', '2026-08-10 06:00:00', '2026-08-10 14:00:00', '2026-08-10 06:00:00'),
        (2, 'tok-2', '2026-08-11', 'Road repair', 'Makina Estate', '2026-08-11 06:00:00', NULL, '2026-08-11 06:00:00');
      INSERT INTO attendance VALUES
        (1, 1, 1, '2026-08-10', '2026-08-10 06:05:00', 'present', NULL, NULL),
        (2, 2, 1, '2026-08-10', '2026-08-10 06:10:00', 'present', NULL, NULL),
        (3, 1, 2, '2026-08-11', '2026-08-11 06:02:00', 'present', NULL, NULL);

      INSERT INTO absence_requests VALUES
        (1, 1, 'annual_leave', '2026-08-20', '2026-08-25', '2026-08-26', 'Family event', 'approved', 1, 2, 'Granted', '2026-08-15 10:00:00', '2026-08-16 10:00:00');
      INSERT INTO absences VALUES
        (1, 2, 'sick_off', '2026-08-05', '2026-08-06', '2026-08-07', 'Malaria', NULL, 'approved');
      INSERT INTO planned_leave VALUES
        (1, 3, 'Annual leave', '2026-09-01', '2026-09-03', '2026-09-04', 'submitted', NULL);

      INSERT INTO documents VALUES
        (1, 1, 'legacy-doc-1', 'medical.pdf', 'application/pdf', ${doc1.length}, '${sha256Hex(doc1)}', 'medical', 1, '2026-08-15 10:00:00');
      INSERT INTO document_classifications VALUES
        (1, 1, 'sick_sheet');

      INSERT INTO work_logs VALUES
        (1, '2026-08-10', 'Market clean-up', 'Makina Market', 'Cleaned the market area', NULL, NULL, 12, 'Rain delay', 'submitted', 2, NULL, NULL, '2026-08-10 18:00:00', NULL),
        (2, '2026-08-11', 'Road repair', 'Makina Estate', 'Repaired the access road', 3.0, 'trucks', 6, NULL, 'submitted', 2, 1, 'Pending', '2026-08-11 18:00:00', NULL);
      INSERT INTO work_log_details VALUES
        (1, 1, 'incomplete', 'Remaining drains'),
        (2, 2, 'complete', NULL);
      INSERT INTO work_log_operations VALUES
        (1, 1, 'Makina Market access', 4, 1, 'TRK-01', NULL, 1, 'Community group', 8),
        (2, 2, 'Makina Estate road', 2, 0, NULL, 'BKH-02', 0, NULL, 5);

      INSERT INTO work_photos VALUES
        (1, 1, '${photo1}', 'before.jpg', 'image/jpeg', ${photo1.length}, '${sha256Hex(photo1)}', 'Before works', 2, '2026-08-10 18:00:00'),
        (2, 1, '${photo2}', 'field.jpg', 'image/jpeg', ${photo2.length}, '${sha256Hex(photo2)}', 'During works', 2, '2026-08-10 18:00:00'),
        (3, 2, '${photo3}', 'after.jpg', 'image/jpeg', ${photo3.length}, '${sha256Hex(photo3)}', 'After works', 2, '2026-08-11 18:00:00');
      INSERT INTO work_photo_stages VALUES
        (1, 1, 'before'),
        (2, 2, 'field'),
        (3, 3, 'after');

      INSERT INTO report_records VALUES
        (1, 'daily', '2026-08-10', '2026-08-10', 'finalized', 'Makina Daily 2026-08-10', 'Daily narrative', '${snapshot}', 1, '2026-08-10 19:00:00');

      INSERT INTO reminder_deliveries VALUES
        (1, 1, 3, 'amina@example.com', 'sent', 'Reminder: annual leave starts soon', '2026-08-17 08:00:00', '2026-08-17 08:00:00');

      INSERT INTO audit_events VALUES
        (1, '2026-08-10 08:00:00', 1, 'login', 'user', '1', 'Admin login', '127.0.0.1');
    `);
    db.close();

    const rows = readLegacyDatabase(dbPath);
    const migrator = new LegacyMigrator(
      { prisma, storage, legacyDb: dbPath, legacyDocRoot: legacyRoot },
      rows,
    );
    const report = await migrator.run(dbPath);

    expect(report.success).toBe(true);

    const users = await prisma.user.findMany({ orderBy: { email: "asc" } });
    expect(users).toHaveLength(3);
    const admin = users.find((u) => u.email === "admin@makina.legacy")!;
    const adminAssignment = await prisma.assignment.findFirst({
      where: { userId: admin.id },
      include: { role: true },
    });
    expect(adminAssignment!.role.code).toBe("SYSTEM_ADMIN");

    const readonly = users.find((u) => u.email === "readonly@makina.legacy")!;
    const readonlyRole = await prisma.role.findUnique({
      where: { code: "READ_ONLY" },
      include: { capabilities: { include: { capability: true } } },
    });
    expect(readonlyRole!.capabilities.map((c) => c.capability.code)).toContain("REPORTS_READ");
    const readonlyAssignment = await prisma.assignment.findFirst({
      where: { userId: readonly.id },
      include: { role: true },
    });
    expect(readonlyAssignment!.role.code).toBe("READ_ONLY");

    const employees = await prisma.employee.findMany({ orderBy: { employeeNumber: "asc" } });
    expect(employees.map((e) => e.employeeNumber)).toEqual(["NCC-1042", "NCC-1043", "NCC-1044"]);
    expect(employees[0].active).toBe(true);
    expect(employees[2].active).toBe(false);

    expect(await prisma.attendanceSession.count()).toBe(2);
    expect(await prisma.attendance.count()).toBe(3);

    const absences = await prisma.absenceRequest.findMany({ orderBy: { startDate: "asc" } });
    expect(absences).toHaveLength(3);
    expect(absences.map((a) => a.kind).sort()).toEqual([
      "ANNUAL_LEAVE",
      "ANNUAL_LEAVE",
      "SICK_OFF",
    ]);

    expect(await prisma.workLog.count()).toBe(2);
    expect(await prisma.workLogDetail.count()).toBe(2);
    expect(await prisma.workLogOperations.count()).toBe(2);

    const evidence = await prisma.evidence.findMany({ orderBy: { caption: "asc" } });
    expect(evidence).toHaveLength(3);
    expect(evidence.map((e) => e.stage).sort()).toEqual(["AFTER", "BEFORE", "DURING"]);
    for (const item of evidence) {
      const object = await storage.read(item.objectKey);
      expect(object.length).toBeGreaterThan(0);
    }

    const documents = await prisma.document.findMany();
    expect(documents).toHaveLength(1);
    expect(await prisma.documentClassification.count()).toBe(1);

    const reports = await prisma.report.findMany();
    expect(reports).toHaveLength(1);
    expect(reports[0].kind).toBe("DAILY");
    expect(reports[0].scopeType).toBe("WARD");
    const reportEvidence = await prisma.reportEvidence.count();
    expect(reportEvidence).toBe(2);

    expect(await prisma.reminderDelivery.count()).toBe(1);
    expect(await prisma.auditEvent.count()).toBe(1);
    expect(await prisma.userSession.count()).toBe(1);

    const summary = migrator.summarize();
    expect(summary.join("\n")).toContain("migrated");
    expect(report.reconciliation.objectsWithoutMetadata).toHaveLength(0);
    expect(report.reconciliation.metadataWithoutObject).toHaveLength(0);
  });

  it("reports a missing legacy file without fabricating evidence", async () => {
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const dbPath = path.join(workDir, "broken.db");
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, display_name TEXT, password_hash TEXT, role TEXT, permissions TEXT, active INTEGER, must_change_password INTEGER, created_at TEXT);
      CREATE TABLE employees (id INTEGER PRIMARY KEY, employee_number TEXT, full_name TEXT, phone TEXT, email TEXT, role TEXT, active INTEGER);
      CREATE TABLE work_logs (id INTEGER PRIMARY KEY, work_date TEXT, activity TEXT, location TEXT, description TEXT, quantity REAL, unit TEXT, staff_count INTEGER, challenges TEXT, status TEXT, submitted_by INTEGER, reviewed_by INTEGER, review_note TEXT, created_at TEXT, reviewed_at TEXT);
      CREATE TABLE work_photos (id INTEGER PRIMARY KEY, work_log_id INTEGER, storage_key TEXT, original_filename TEXT, content_type TEXT, size_bytes INTEGER, sha256 TEXT, caption TEXT, uploaded_by INTEGER, uploaded_at TEXT);
      CREATE TABLE work_photo_stages (id INTEGER PRIMARY KEY, photo_id INTEGER, stage TEXT);
      INSERT INTO users VALUES (1, 'admin@makina.legacy', 'System Admin', 'scrypt$x', 'system_admin', NULL, 1, 1, '2026-08-01 08:00:00');
      INSERT INTO employees VALUES (1, 'NCC-1042', 'Amina Wanjiku', '0712345601', NULL, 'Team Leader', 1);
      INSERT INTO work_logs VALUES (1, '2026-08-10', 'Market clean-up', 'Makina Market', 'desc', NULL, NULL, 1, NULL, 'submitted', 1, NULL, NULL, '2026-08-10 18:00:00', NULL);
      INSERT INTO work_photos VALUES (1, 1, 'missing-photo', 'missing.jpg', 'image/jpeg', 10, 'deadbeef', 'Missing photo', 1, '2026-08-10 18:00:00');
    `);
    db.close();

    const rows = readLegacyDatabase(dbPath);
    const migrator = new LegacyMigrator(
      { prisma, storage, legacyDb: dbPath, legacyDocRoot: legacyRoot },
      rows,
    );
    const report = await migrator.run(dbPath);

    expect(report.success).toBe(false);
    expect(await prisma.evidence.count()).toBe(0);
    const records = report.files.filter((f) => f.legacyTable === "work_photos");
    expect(records[0].outcome).toBe("MISSING_FILE");
  });

  it("is idempotent: a re-run does not duplicate migrated records or objects", async () => {
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const dbPath = path.join(workDir, "rerun.db");
    const db = new DatabaseSync(dbPath);

    const photo = "rerun-photo";
    const doc = "rerun-doc";
    await writeFile(path.join(legacyRoot, photo), photo);
    await writeFile(path.join(legacyRoot, doc), doc);

    const snapshot = JSON.stringify({
      work_logs: [
        {
          id: 1,
          activity: "Market clean-up",
          completion_status: "complete",
          photos: [{ id: 1, stage: "before", caption: "Before", sha256: sha256Hex(photo) }],
        },
      ],
    });

    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, display_name TEXT, password_hash TEXT, role TEXT, permissions TEXT, active INTEGER, must_change_password INTEGER, created_at TEXT);
      CREATE TABLE employees (id INTEGER PRIMARY KEY, employee_number TEXT, full_name TEXT, phone TEXT, email TEXT, role TEXT, active INTEGER);
      CREATE TABLE work_logs (id INTEGER PRIMARY KEY, work_date TEXT, activity TEXT, location TEXT, description TEXT, quantity REAL, unit TEXT, staff_count INTEGER, challenges TEXT, status TEXT, submitted_by INTEGER, reviewed_by INTEGER, review_note TEXT, created_at TEXT, reviewed_at TEXT);
      CREATE TABLE work_log_details (id INTEGER PRIMARY KEY, work_log_id INTEGER, completion_status TEXT, outstanding_work TEXT);
      CREATE TABLE work_log_operations (id INTEGER PRIMARY KEY, work_log_id INTEGER, areas_roads TEXT, number_of_trips INTEGER, waste_transfer_involved INTEGER, truck_id TEXT, backhoe_id TEXT, cleanup_done INTEGER, cleanup_stakeholders TEXT, climate_team_count INTEGER);
      CREATE TABLE work_photos (id INTEGER PRIMARY KEY, work_log_id INTEGER, storage_key TEXT, original_filename TEXT, content_type TEXT, size_bytes INTEGER, sha256 TEXT, caption TEXT, uploaded_by INTEGER, uploaded_at TEXT);
      CREATE TABLE work_photo_stages (id INTEGER PRIMARY KEY, photo_id INTEGER, stage TEXT);
      CREATE TABLE documents (id INTEGER PRIMARY KEY, absence_request_id INTEGER, storage_key TEXT, original_filename TEXT, content_type TEXT, size_bytes INTEGER, sha256 TEXT, sensitivity TEXT, uploaded_by INTEGER, uploaded_at TEXT);
      CREATE TABLE report_records (id INTEGER PRIMARY KEY, kind TEXT, start_date TEXT, end_date TEXT, status TEXT, title TEXT, narrative TEXT, snapshot_json TEXT, created_by INTEGER, created_at TEXT);

      INSERT INTO users VALUES (1, 'admin@rerun.legacy', 'System Admin', 'scrypt$x', 'system_admin', NULL, 1, 0, '2026-08-01 08:00:00');
      INSERT INTO employees VALUES (1, 'NCC-2001', 'Rerun Staff', '0722000001', NULL, 'Team Leader', 1);
      INSERT INTO work_logs VALUES (1, '2026-08-10', 'Market clean-up', 'Makina Market', 'desc', NULL, NULL, 5, NULL, 'approved', 1, NULL, NULL, '2026-08-10 18:00:00', NULL);
      INSERT INTO work_log_details VALUES (1, 1, 'complete', NULL);
      INSERT INTO work_log_operations VALUES (1, 1, 'Market', 2, 0, NULL, NULL, 0, NULL, 0);
      INSERT INTO work_photos VALUES (1, 1, '${photo}', 'photo.jpg', 'image/jpeg', ${photo.length}, '${sha256Hex(photo)}', 'Before', 1, '2026-08-10 18:00:00');
      INSERT INTO work_photo_stages VALUES (1, 1, 'before');
      INSERT INTO documents VALUES (1, NULL, '${doc}', 'doc.pdf', 'application/pdf', ${doc.length}, '${sha256Hex(doc)}', 'general', 1, '2026-08-10 18:00:00');
      INSERT INTO report_records VALUES (1, 'daily', '2026-08-10', '2026-08-10', 'finalized', 'Daily', 'narrative', '${snapshot}', 1, '2026-08-10 19:00:00');
    `);
    db.close();

    const options = { prisma, storage, legacyDb: dbPath, legacyDocRoot: legacyRoot };
    const first = await new LegacyMigrator(options, readLegacyDatabase(dbPath)).run(dbPath);
    expect(first.success).toBe(true);

    const expected = {
      users: await prisma.user.count(),
      employees: await prisma.employee.count(),
      workLogs: await prisma.workLog.count(),
      evidence: await prisma.evidence.count(),
      documents: await prisma.document.count(),
      reports: await prisma.report.count(),
      reportEvidence: await prisma.reportEvidence.count(),
      objects: (await storage.list()).length,
    };
    expect(expected.evidence).toBe(1);
    expect(expected.documents).toBe(1);
    expect(expected.reports).toBe(1);

    const second = await new LegacyMigrator(options, readLegacyDatabase(dbPath)).run(dbPath);
    expect(second.success).toBe(true);

    expect(await prisma.user.count()).toBe(expected.users);
    expect(await prisma.employee.count()).toBe(expected.employees);
    expect(await prisma.workLog.count()).toBe(expected.workLogs);
    expect(await prisma.evidence.count()).toBe(expected.evidence);
    expect(await prisma.document.count()).toBe(expected.documents);
    expect(await prisma.report.count()).toBe(expected.reports);
    expect(await prisma.reportEvidence.count()).toBe(expected.reportEvidence);
    expect((await storage.list()).length).toBe(expected.objects);
    expect(second.reconciliation.objectsWithoutMetadata).toHaveLength(0);
    expect(second.reconciliation.metadataWithoutObject).toHaveLength(0);
  });

  it("reports unreferenced legacy files without fabricating metadata", async () => {
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const dbPath = path.join(workDir, "orphans.db");
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, display_name TEXT, password_hash TEXT, role TEXT, permissions TEXT, active INTEGER, must_change_password INTEGER, created_at TEXT);
      INSERT INTO users VALUES (1, 'admin@makina.legacy', 'System Admin', 'scrypt$x', 'system_admin', NULL, 1, 0, '2026-08-01 08:00:00');
    `);
    db.close();

    // A legacy file on disk with no matching DB row.
    await writeFile(path.join(legacyRoot, "orphan-file"), "unreferenced bytes");

    const report = await new LegacyMigrator(
      { prisma, storage, legacyDb: dbPath, legacyDocRoot: legacyRoot },
      readLegacyDatabase(dbPath),
    ).run(dbPath);

    expect(report.unreferencedLegacyFiles).toContain("orphan-file");
  });

  it("grants read-only capabilities per user without mutating the shared role", async () => {
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const dbPath = path.join(workDir, "readonly.db");
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, display_name TEXT, password_hash TEXT, role TEXT, permissions TEXT, active INTEGER, must_change_password INTEGER, created_at TEXT);
      INSERT INTO users VALUES
        (1, 'admin@makina.legacy', 'System Admin', 'scrypt$x', 'system_admin', NULL, 1, 0, '2026-08-01 08:00:00'),
        (2, 'audit.ro@makina.legacy', 'Audit Read Only', 'scrypt$y', 'read_only', 'audit,reports', 1, 0, '2026-08-01 08:00:00'),
        (3, 'plain.ro@makina.legacy', 'Plain Read Only', 'scrypt$z', 'read_only', 'reports', 1, 0, '2026-08-01 08:00:00');
    `);
    db.close();

    const report = await new LegacyMigrator(
      { prisma, storage, legacyDb: dbPath, legacyDocRoot: legacyRoot },
      readLegacyDatabase(dbPath),
    ).run(dbPath);
    expect(report.success).toBe(true);

    const sharedRole = await prisma.role.findUniqueOrThrow({
      where: { code: "READ_ONLY" },
      include: { capabilities: { include: { capability: true } } },
    });
    const sharedCodes = sharedRole.capabilities.map((c) => c.capability.code);
    expect(sharedCodes).not.toContain("AUDIT_READ");

    const auditUser = await prisma.user.findUniqueOrThrow({
      where: { email: "audit.ro@makina.legacy" },
      include: { capabilities: { include: { capability: true } } },
    });
    expect(auditUser.capabilities.map((c) => c.capability.code)).toContain("AUDIT_READ");

    const plainUser = await prisma.user.findUniqueOrThrow({
      where: { email: "plain.ro@makina.legacy" },
      include: { capabilities: { include: { capability: true } } },
    });
    expect(plainUser.capabilities.map((c) => c.capability.code)).not.toContain("AUDIT_READ");

    const auditAssignment = await prisma.assignment.findFirstOrThrow({
      where: { userId: auditUser.id },
    });
    expect(auditAssignment.scopeType).toBe("WARD");
  });
});
