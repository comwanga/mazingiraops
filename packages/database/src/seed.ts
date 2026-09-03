import { CapabilityCode, PrismaClient, RoleCode } from "@prisma/client";
import { NAIROBI_SUBCOUNTIES } from "./nairobi-hierarchy";

const prisma = new PrismaClient();

const CAPABILITIES: Array<{ code: CapabilityCode; name: string }> = [
  { code: "STAFF_READ", name: "View staff register" },
  { code: "STAFF_MANAGE", name: "Manage staff" },
  { code: "STAFF_IMPORT", name: "Import staff registers" },
  { code: "ATTENDANCE_READ", name: "View attendance" },
  { code: "ATTENDANCE_MANAGE", name: "Manage attendance" },
  { code: "WORK_READ", name: "View work logs" },
  { code: "WORK_CREATE", name: "Create work logs" },
  { code: "WORK_REVIEW", name: "Review work logs" },
  { code: "ABSENCE_READ", name: "View absences" },
  { code: "ABSENCE_MANAGE", name: "Manage absences" },
  { code: "ABSENCE_REVIEW", name: "Review absences" },
  { code: "MEDICAL_READ", name: "Access medical documents" },
  { code: "REPORTS_READ", name: "View reports" },
  { code: "REPORTS_GENERATE", name: "Generate report previews" },
  { code: "REPORTS_EXPORT", name: "Export reports" },
  { code: "REPORTS_FINALIZE", name: "Finalize reports" },
  { code: "AUDIT_READ", name: "View audit history" },
  { code: "USERS_MANAGE", name: "Manage users" },
  { code: "USERS_READ", name: "View users" },
  { code: "USERS_DISABLE", name: "Disable and restore users" },
  { code: "PERMISSIONS_MANAGE", name: "Manage permissions" },
  { code: "SCOPE_MANAGE", name: "Manage organisational scope" },
  { code: "RECORD_ARCHIVE", name: "Archive operational records" },
  { code: "EVIDENCE_REMOVE", name: "Remove operational evidence" },
];

const ROLE_CAPABILITIES: Record<RoleCode, CapabilityCode[]> = {
  SYSTEM_ADMIN: [
    "REPORTS_READ",
    "USERS_MANAGE",
    "USERS_READ",
    "USERS_DISABLE",
    "PERMISSIONS_MANAGE",
    "SCOPE_MANAGE",
  ],
  WARD_OFFICER: [
    "STAFF_READ",
    "STAFF_MANAGE",
    "STAFF_IMPORT",
    "ATTENDANCE_READ",
    "ATTENDANCE_MANAGE",
    "WORK_READ",
    "WORK_CREATE",
    "ABSENCE_READ",
    "ABSENCE_MANAGE",
    "REPORTS_READ",
    "REPORTS_GENERATE",
    "REPORTS_FINALIZE",
  ],
  SUBCOUNTY_REVIEWER: [
    "STAFF_READ",
    "ATTENDANCE_READ",
    "WORK_READ",
    "WORK_REVIEW",
    "ABSENCE_READ",
    "ABSENCE_REVIEW",
    "REPORTS_READ",
    "REPORTS_GENERATE",
    "REPORTS_EXPORT",
    "REPORTS_FINALIZE",
    "AUDIT_READ",
  ],
  CHIEF_SUBCOUNTY_OFFICER: [
    "STAFF_READ", "ATTENDANCE_READ", "WORK_READ", "WORK_REVIEW",
    "ABSENCE_READ", "ABSENCE_REVIEW", "REPORTS_READ", "REPORTS_GENERATE",
    "REPORTS_EXPORT", "REPORTS_FINALIZE", "AUDIT_READ",
  ],
  ASSISTANT_DIRECTOR: [
    "STAFF_READ", "ATTENDANCE_READ", "WORK_READ", "WORK_REVIEW",
    "ABSENCE_READ", "ABSENCE_REVIEW", "REPORTS_READ", "REPORTS_GENERATE",
    "REPORTS_EXPORT", "AUDIT_READ",
  ],
  DEPUTY_DIRECTOR: [
    "STAFF_READ", "ATTENDANCE_READ", "WORK_READ", "WORK_REVIEW",
    "ABSENCE_READ", "ABSENCE_REVIEW", "REPORTS_READ", "REPORTS_GENERATE",
    "REPORTS_EXPORT", "REPORTS_FINALIZE", "AUDIT_READ",
  ],
  DIRECTOR: [
    "STAFF_READ", "ATTENDANCE_READ", "WORK_READ", "ABSENCE_READ",
    "REPORTS_READ", "REPORTS_GENERATE", "REPORTS_EXPORT", "REPORTS_FINALIZE", "AUDIT_READ",
  ],
  HR_VIEWER: [
    "STAFF_READ",
    "ATTENDANCE_READ",
    "ABSENCE_READ",
    "ABSENCE_MANAGE",
    "ABSENCE_REVIEW",
    "MEDICAL_READ",
    "REPORTS_READ",
    "REPORTS_GENERATE",
  ],
  // READ_ONLY mirrors the legacy "read-only benchmark" default grants.
  READ_ONLY: ["ATTENDANCE_READ", "REPORTS_READ"],
};

async function main() {
  const capabilityByCode = new Map<string, string>();
  for (const capability of CAPABILITIES) {
    const created = await prisma.capability.upsert({
      where: { code: capability.code },
      update: { name: capability.name },
      create: capability,
    });
    capabilityByCode.set(created.code, created.id);
  }

  for (const [roleCode, capabilityCodes] of Object.entries(ROLE_CAPABILITIES)) {
    const role = await prisma.role.upsert({
      where: { code: roleCode as RoleCode },
      update: { name: roleCode.replace(/_/g, " ").toLowerCase() },
      create: { code: roleCode as RoleCode, name: roleCode.replace(/_/g, " ").toLowerCase() },
    });
    // Custom role bundles remain operator-managed. SYSTEM_ADMIN is a security
    // boundary and is always reconciled to the non-operational allowlist.
    if (role.permissionsManagedAt && role.code !== "SYSTEM_ADMIN") continue;
    const expectedCapabilityIds = capabilityCodes
      .map((code) => capabilityByCode.get(code))
      .filter((id): id is string => id !== undefined);
    await prisma.roleCapability.deleteMany({
      where: { roleId: role.id, capabilityId: { notIn: expectedCapabilityIds } },
    });
    for (const capabilityCode of capabilityCodes) {
      const capabilityId = capabilityByCode.get(capabilityCode);
      if (!capabilityId) continue;
      await prisma.roleCapability.upsert({
        where: { roleId_capabilityId: { roleId: role.id, capabilityId } },
        update: {},
        create: { roleId: role.id, capabilityId },
      });
    }
  }

  const county = await prisma.county.upsert({
    where: { code: "NCC" },
    update: { name: "Nairobi City County" },
    create: { code: "NCC", name: "Nairobi City County" },
  });

  for (const reference of NAIROBI_SUBCOUNTIES) {
    const subcounty = await prisma.subcounty.upsert({
      where: { code: reference.code },
      update: { name: reference.name, countyId: county.id },
      create: { code: reference.code, name: reference.name, countyId: county.id },
    });
    for (const ward of reference.wards) {
      await prisma.ward.upsert({
        where: { code: ward.code },
        update: { name: ward.name, subcountyId: subcounty.id },
        create: { code: ward.code, name: ward.name, subcountyId: subcounty.id },
      });
    }
  }

  console.log("Seed complete: capabilities, roles, Nairobi's 17 sub-counties and 85 wards.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
