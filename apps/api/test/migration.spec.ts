import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("node:sqlite", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  return require("node:sqlite");
});

import {
  decomposePermissions,
  deriveRecommendations,
  mapEvidenceStage,
} from "../src/migration/mapping";
import { migrateLegacyFile } from "../src/migration/evidence";
import { readLegacyDatabase } from "../src/migration/legacy-db";
import { LocalObjectStorage } from "../src/storage/object-storage.service";

function sha256Hex(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function appConfig(documentStoreDir: string) {
  return {
    env: "test",
    port: 0,
    databaseUrl: "postgresql://x",
    redis: { configured: false, connectTimeoutMs: 2_000, dashboardTtlSeconds: 120 },
    publicBaseUrl: "http://localhost:3000",
    sessionHours: 12,
    secureCookies: false,
    storage: {
      region: "us-east-1",
      forcePathStyle: false,
      configured: false,
    },
    ownerSetupToken: "token",
    smtp: { port: 587, from: "x@y.z", configured: false },
    ai: { enabled: false, baseUrl: "", model: "" },
    maxUploadBytes: 1024 * 1024,
    documentStoreDir,
  };
}

describe("migration mapping", () => {
  it("maps legacy attendance statuses to enums", () => {
    expect(mapEvidenceStage("before")).toBe("BEFORE");
    expect(mapEvidenceStage("during")).toBe("DURING");
    expect(mapEvidenceStage("after")).toBe("AFTER");
    expect(mapEvidenceStage("field")).toBe("DURING");
    expect(mapEvidenceStage(null)).toBe("DURING");
    expect(mapEvidenceStage("unknown")).toBe("DURING");
  });

  it("decomposes legacy permission CSV into capability codes", () => {
    expect(decomposePermissions("attendance,reports")).toEqual([
      "ATTENDANCE_READ",
      "REPORTS_READ",
    ]);
    expect(decomposePermissions("audit")).toEqual(["AUDIT_READ"]);
    expect(decomposePermissions(null)).toEqual([]);
    expect(decomposePermissions("")).toEqual([]);
    expect(decomposePermissions("not-a-scope")).toEqual([]);
  });

  it("derives recommendations from a legacy snapshot", () => {
    expect(
      deriveRecommendations({
        work_logs: [
          { activity: "Market clean-up", completion_status: "incomplete" },
          { activity: "Road repair", completion_status: "complete" },
          { activity: "Market clean-up", completion_status: "incomplete" },
        ],
      }),
    ).toContain("Market clean-up");
    expect(
      deriveRecommendations({ work_logs: [{ completion_status: "complete" }] }),
    ).toContain("Sustain the completed activities");
    expect(deriveRecommendations(null)).toContain("Sustain");
    expect(deriveRecommendations({})).toContain("Sustain");
  });
});

describe("legacy database reader", () => {
  it("reads rows and reports missing tables as empty", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "legacy-"));
    const dbPath = path.join(dir, "makina.db");
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE employees (id INTEGER PRIMARY KEY, employee_number TEXT, full_name TEXT, phone TEXT, email TEXT, role TEXT, active INTEGER);
      INSERT INTO employees VALUES (1, 'NCC-1042', 'Amina Wanjiku', '0712345601', 'a@b.c', 'Team Leader', 1);
    `);
    db.close();

    const rows = readLegacyDatabase(dbPath);
    expect(rows.employees).toHaveLength(1);
    expect(rows.employees[0]).toMatchObject({ employee_number: "NCC-1042", active: 1 });
    expect(rows.work_photos).toEqual([]);
    expect(rows.documents).toEqual([]);
    expect(rows.absence_requests).toEqual([]);

    await rm(dir, { recursive: true, force: true });
  });
});

describe("broken-photo-safe evidence migration", () => {
  it("migrates a verified file and returns its object key", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "evidence-"));
    const legacyRoot = path.join(dir, "legacy");
    const storageRoot = path.join(dir, "storage");
    await rm(legacyRoot, { recursive: true, force: true });
    await mkdir(legacyRoot);
    await rm(storageRoot, { recursive: true, force: true });
    await mkdir(storageRoot);

    const content = Buffer.from("field photo bytes");
    const key = "a".repeat(48);
    await writeFile(path.join(legacyRoot, key), content);

    const storage = new LocalObjectStorage(appConfig(storageRoot) as never);
    const record = await migrateLegacyFile(storage, legacyRoot, {
      legacyTable: "work_photos",
      legacyId: 7,
      storageKey: key,
      originalName: "photo.jpg",
      contentType: "image/jpeg",
      sizeBytes: content.length,
      sha256: sha256Hex(content),
    });

    expect(record.outcome).toBe("MIGRATED");
    expect(record.objectKey).toMatch(/^[0-9a-f]{48}$/);
    const stored = await storage.read(record.objectKey!);
    expect(createHash("sha256").update(stored).digest("hex")).toBe(sha256Hex(content));

    await rm(dir, { recursive: true, force: true });
  });

  it("reports a missing legacy file without fabricating metadata", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "evidence-"));
    const legacyRoot = path.join(dir, "legacy");
    const storageRoot = path.join(dir, "storage");
    await rm(legacyRoot, { recursive: true, force: true });
    await mkdir(legacyRoot);
    await rm(storageRoot, { recursive: true, force: true });
    await mkdir(storageRoot);

    const storage = new LocalObjectStorage(appConfig(storageRoot) as never);
    const record = await migrateLegacyFile(storage, legacyRoot, {
      legacyTable: "documents",
      legacyId: 3,
      storageKey: "b".repeat(48),
      originalName: "leave.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      sha256: "c".repeat(64),
    });

    expect(record.outcome).toBe("MISSING_FILE");
    expect(record.objectKey).toBeUndefined();

    await rm(dir, { recursive: true, force: true });
  });

  it("quarantines a hash mismatch and leaves no object behind", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "evidence-"));
    const legacyRoot = path.join(dir, "legacy");
    const storageRoot = path.join(dir, "storage");
    await rm(legacyRoot, { recursive: true, force: true });
    await mkdir(legacyRoot);
    await rm(storageRoot, { recursive: true, force: true });
    await mkdir(storageRoot);

    const content = Buffer.from("tampered bytes");
    const key = "c".repeat(48);
    await writeFile(path.join(legacyRoot, key), content);

    const storage = new LocalObjectStorage(appConfig(storageRoot) as never);
    const record = await migrateLegacyFile(storage, legacyRoot, {
      legacyTable: "work_photos",
      legacyId: 9,
      storageKey: key,
      originalName: "photo.jpg",
      contentType: "image/jpeg",
      sizeBytes: content.length,
      sha256: "f".repeat(64),
    });

    expect(record.outcome).toBe("HASH_MISMATCH");
    expect(record.objectKey).toBeUndefined();
    expect(await storage.list()).toEqual([]);

    await rm(dir, { recursive: true, force: true });
  });

  it("reports a size mismatch as a hash mismatch (integrity failure)", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "evidence-"));
    const legacyRoot = path.join(dir, "legacy");
    const storageRoot = path.join(dir, "storage");
    await rm(legacyRoot, { recursive: true, force: true });
    await mkdir(legacyRoot);
    await rm(storageRoot, { recursive: true, force: true });
    await mkdir(storageRoot);

    const content = Buffer.from("small");
    const key = "d".repeat(48);
    await writeFile(path.join(legacyRoot, key), content);

    const storage = new LocalObjectStorage(appConfig(storageRoot) as never);
    const record = await migrateLegacyFile(storage, legacyRoot, {
      legacyTable: "documents",
      legacyId: 5,
      storageKey: key,
      originalName: "leave.pdf",
      contentType: "application/pdf",
      sizeBytes: 999,
      sha256: sha256Hex(content),
    });

    expect(record.outcome).toBe("HASH_MISMATCH");
    expect(record.objectKey).toBeUndefined();

    await rm(dir, { recursive: true, force: true });
  });
});
