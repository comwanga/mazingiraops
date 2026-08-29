import { randomBytes, scryptSync } from "node:crypto";
import { CapabilityCode, PrismaClient, RoleCode } from "@prisma/client";

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64, { N: 2 ** 14, r: 8, p: 1 });
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

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
  SYSTEM_ADMIN: CAPABILITIES.map((c) => c.code),
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
    if (role.permissionsManagedAt) continue;
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

  const NAIROBI_SUBCOUNTIES_AND_WARDS = [
    {
      code: "WESTLANDS",
      name: "Westlands",
      wards: [
        { code: "KITISURU", name: "Kitisuru" },
        { code: "PARKLANDS_HIGHRIDGE", name: "Parklands/Highridge" },
        { code: "KARURA", name: "Karura" },
        { code: "KANGEMI", name: "Kangemi" },
        { code: "MOUNTAIN_VIEW", name: "Mountain View" },
      ],
    },
    {
      code: "DAGORETTI_NORTH",
      name: "Dagoretti North",
      wards: [
        { code: "KILIMANI", name: "Kilimani" },
        { code: "KAWANGWARE", name: "Kawangware" },
        { code: "GATINA", name: "Gatina" },
        { code: "KILELESHWA", name: "Kileleshwa" },
        { code: "KABIRO", name: "Kabiro" },
      ],
    },
    {
      code: "DAGORETTI_SOUTH",
      name: "Dagoretti South",
      wards: [
        { code: "MUTUINI", name: "Mutu-ini" },
        { code: "NGANDO", name: "Ngando" },
        { code: "RIRUTA", name: "Riruta" },
        { code: "UTHIRU_RUTHIMITU", name: "Uthiru/Ruthimitu" },
        { code: "WAITHAKA", name: "Waithaka" },
      ],
    },
    {
      code: "LANGATA",
      name: "Lang'ata",
      wards: [
        { code: "KAREN", name: "Karen" },
        { code: "NAIROBI_WEST", name: "Nairobi West" },
        { code: "MUGUMOINI", name: "Mugumo-ini" },
        { code: "SOUTH_C", name: "South C" },
        { code: "NYAYO_HIGHRIDGE", name: "Nyayo/Highrise" },
      ],
    },
    {
      code: "KIBRA",
      name: "Kibra",
      wards: [
        { code: "LAINI_SABA", name: "Laini Saba" },
        { code: "LINDI", name: "Lindi" },
        { code: "MAKINA", name: "Makina" },
        { code: "WOODLEY_KENYATTA_GOLF", name: "Woodley/Kenyatta Golf Course" },
        { code: "SARANGOMBE", name: "Sarang'ombe" },
      ],
    },
    {
      code: "ROYSAMBU",
      name: "Roysambu",
      wards: [
        { code: "GITHURAI", name: "Githurai" },
        { code: "KAHAWA_WEST", name: "Kahawa West" },
        { code: "ZIMMERMAN", name: "Zimmerman" },
        { code: "ROYSAMBU_WARD", name: "Roysambu" },
        { code: "KAHAWA", name: "Kahawa" },
      ],
    },
    {
      code: "KASARANI",
      name: "Kasarani",
      wards: [
        { code: "CLAY_CITY", name: "Clay City" },
        { code: "MWIKI", name: "Mwiki" },
        { code: "KASARANI_WARD", name: "Kasarani" },
        { code: "NJIRU", name: "Njiru" },
        { code: "RUAI", name: "Ruai" },
      ],
    },
    {
      code: "RUARAKA",
      name: "Ruaraka",
      wards: [
        { code: "BABA_DOGO", name: "Baba Dogo" },
        { code: "UTALII", name: "Utalii" },
        { code: "MATHARE_NORTH", name: "Mathare North" },
        { code: "LUCKY_SUMMER", name: "Lucky Summer" },
        { code: "KOROGOCHO", name: "Korogocho" },
      ],
    },
    {
      code: "EMBAKASI_SOUTH",
      name: "Embakasi South",
      wards: [
        { code: "IMARA_DAIMA", name: "Imara Daima" },
        { code: "KWA_NJENGA", name: "Kwa Njenga" },
        { code: "KWA_REUBEN", name: "Kwa Reuben" },
        { code: "PIPELINE", name: "Pipeline" },
        { code: "KWARE", name: "Kware" },
      ],
    },
    {
      code: "EMBAKASI_NORTH",
      name: "Embakasi North",
      wards: [
        { code: "KARIOBANGI_NORTH", name: "Kariobangi North" },
        { code: "DANDORA_I", name: "Dandora Area I" },
        { code: "DANDORA_II", name: "Dandora Area II" },
        { code: "DANDORA_III", name: "Dandora Area III" },
        { code: "DANDORA_IV", name: "Dandora Area IV" },
      ],
    },
    {
      code: "EMBAKASI_CENTRAL",
      name: "Embakasi Central",
      wards: [
        { code: "KAYOLE_NORTH", name: "Kayole North" },
        { code: "KAYOLE_CENTRAL", name: "Kayole Central" },
        { code: "KAYOLE_SOUTH", name: "Kayole South" },
        { code: "KOMAROCK", name: "Komarock" },
        { code: "MATOPENI_SPRING_VALLEY", name: "Matopeni/Spring Valley" },
      ],
    },
    {
      code: "EMBAKASI_EAST",
      name: "Embakasi East",
      wards: [
        { code: "UPPER_SAVANNA", name: "Upper Savanna" },
        { code: "LOWER_SAVANNA", name: "Lower Savanna" },
        { code: "EMBAKASI_WARD", name: "Embakasi" },
        { code: "UTAWALA", name: "Utawala" },
        { code: "MIHANGO", name: "Mihango" },
      ],
    },
    {
      code: "EMBAKASI_WEST",
      name: "Embakasi West",
      wards: [
        { code: "UMOJA_I", name: "Umoja I" },
        { code: "UMOJA_II", name: "Umoja II" },
        { code: "MOWLEM", name: "Mowlem" },
        { code: "KARIOBANGI_SOUTH", name: "Kariobangi South" },
      ],
    },
    {
      code: "MAKADARA",
      name: "Makadara",
      wards: [
        { code: "MARINGO_HAMZA", name: "Maringo/Hamza" },
        { code: "VIWANDANI", name: "Viwandani" },
        { code: "HARAMBEE", name: "Harambee" },
        { code: "MAKONGENI", name: "Makongeni" },
      ],
    },
    {
      code: "KAMUKUNJI",
      name: "Kamukunji",
      wards: [
        { code: "PUMWANI", name: "Pumwani" },
        { code: "EASTLEIGH_NORTH", name: "Eastleigh North" },
        { code: "EASTLEIGH_SOUTH", name: "Eastleigh South" },
        { code: "AIRBASE", name: "Airbase" },
        { code: "CALIFORNIA", name: "California" },
      ],
    },
    {
      code: "STAREHE",
      name: "Starehe",
      wards: [
        { code: "NAIROBI_CENTRAL", name: "Nairobi Central" },
        { code: "NGARA", name: "Ngara" },
        { code: "PANGANI", name: "Pangani" },
        { code: "ZIWANI_KARIOKOR", name: "Ziwani/Kariokor" },
        { code: "LANDIMAWE", name: "Landimawe" },
        { code: "NAIROBI_SOUTH", name: "Nairobi South" },
      ],
    },
    {
      code: "MATHARE",
      name: "Mathare",
      wards: [
        { code: "HOSPITAL", name: "Hospital" },
        { code: "MABATINI", name: "Mabatini" },
        { code: "HURUMA", name: "Huruma" },
        { code: "NGEI", name: "Ngei" },
        { code: "MLANGO_KUBWA", name: "Mlango Kubwa" },
        { code: "KIAMAIKO", name: "Kiamaiko" },
      ],
    },
  ];

  for (const sub of NAIROBI_SUBCOUNTIES_AND_WARDS) {
    const createdSub = await prisma.subcounty.upsert({
      where: { code: sub.code },
      update: { name: sub.name, countyId: county.id },
      create: { code: sub.code, name: sub.name, countyId: county.id },
    });

    for (const w of sub.wards) {
      await prisma.ward.upsert({
        where: { code: w.code },
        update: { name: w.name, subcountyId: createdSub.id },
        create: { code: w.code, name: w.name, subcountyId: createdSub.id },
      });
    }
  }

  // Seed standard test users
  const kibraSub = await prisma.subcounty.findUnique({ where: { code: "KIBRA" } });
  const makinaWard = await prisma.ward.findUnique({ where: { code: "MAKINA" } });
  const adminRole = await prisma.role.findUnique({ where: { code: "SYSTEM_ADMIN" } });
  const wardOfficerRole = await prisma.role.findUnique({ where: { code: "WARD_OFFICER" } });
  const subcountyReviewerRole = await prisma.role.findUnique({ where: { code: "SUBCOUNTY_REVIEWER" } });
  const directorRole = await prisma.role.findUnique({ where: { code: "DIRECTOR" } });

  // 1. System Administrator
  if (adminRole) {
    const adminUser = await prisma.user.upsert({
      where: { email: "admin@nairobi.go.ke" },
      update: {
        displayName: "Nairobi System Administrator",
        passwordHash: hashPassword("Admin@Nairobi2026!Ops"),
        active: true,
        mustChangePassword: false,
      },
      create: {
        email: "admin@nairobi.go.ke",
        displayName: "Nairobi System Administrator",
        passwordHash: hashPassword("Admin@Nairobi2026!Ops"),
        active: true,
        mustChangePassword: false,
      },
    });
    await prisma.roleAssignment.deleteMany({ where: { userId: adminUser.id } });
    await prisma.scopeAssignment.deleteMany({ where: { userId: adminUser.id } });
    await prisma.roleAssignment.create({ data: { userId: adminUser.id, roleId: adminRole.id } });
    await prisma.scopeAssignment.create({
      data: { userId: adminUser.id, scopeType: "COUNTY", countyId: county.id },
    });
  }

  // 2. Ward Environment Officer (Makina Ward)
  if (wardOfficerRole && makinaWard) {
    const wardUser = await prisma.user.upsert({
      where: { email: "ward.officer@nairobi.go.ke" },
      update: {
        displayName: "Makina Ward Officer",
        passwordHash: hashPassword("Officer@Makina2026!Ops"),
        active: true,
        mustChangePassword: false,
      },
      create: {
        email: "ward.officer@nairobi.go.ke",
        displayName: "Makina Ward Officer",
        passwordHash: hashPassword("Officer@Makina2026!Ops"),
        active: true,
        mustChangePassword: false,
      },
    });
    await prisma.roleAssignment.deleteMany({ where: { userId: wardUser.id } });
    await prisma.scopeAssignment.deleteMany({ where: { userId: wardUser.id } });
    await prisma.roleAssignment.create({ data: { userId: wardUser.id, roleId: wardOfficerRole.id } });
    await prisma.scopeAssignment.create({
      data: { userId: wardUser.id, scopeType: "WARD", wardId: makinaWard.id },
    });

    // Seed sample field staff in Makina Ward
    const sampleStaff = [
      { staffNumber: "ENV-MK-001", fullName: "John Otieno Omolo", phone: "0712345678" },
      { staffNumber: "ENV-MK-002", fullName: "Mary Wambui Kamau", phone: "0723456789" },
      { staffNumber: "ENV-MK-003", fullName: "Hassan Ali Mohamed", phone: "0734567890" },
      { staffNumber: "ENV-MK-004", fullName: "Grace Akinyi Ochieng", phone: "0745678901" },
    ];
    for (const staff of sampleStaff) {
      await prisma.staff.upsert({
        where: { staffNumber: staff.staffNumber },
        update: { fullName: staff.fullName, phone: staff.phone, wardId: makinaWard.id, active: true },
        create: {
          staffNumber: staff.staffNumber,
          fullName: staff.fullName,
          phone: staff.phone,
          wardId: makinaWard.id,
          active: true,
        },
      });
    }
  }

  // 3. Sub-County Environment Officer (Kibra Sub-County)
  if (subcountyReviewerRole && kibraSub) {
    const subUser = await prisma.user.upsert({
      where: { email: "subcounty.officer@nairobi.go.ke" },
      update: {
        displayName: "Kibra Sub-County Officer",
        passwordHash: hashPassword("Officer@Kibra2026!Ops"),
        active: true,
        mustChangePassword: false,
      },
      create: {
        email: "subcounty.officer@nairobi.go.ke",
        displayName: "Kibra Sub-County Officer",
        passwordHash: hashPassword("Officer@Kibra2026!Ops"),
        active: true,
        mustChangePassword: false,
      },
    });
    await prisma.roleAssignment.deleteMany({ where: { userId: subUser.id } });
    await prisma.scopeAssignment.deleteMany({ where: { userId: subUser.id } });
    await prisma.roleAssignment.create({ data: { userId: subUser.id, roleId: subcountyReviewerRole.id } });
    await prisma.scopeAssignment.create({
      data: { userId: subUser.id, scopeType: "SUBCOUNTY", subcountyId: kibraSub.id },
    });
  }

  // 4. Director of Environment (County-wide)
  if (directorRole) {
    const directorUser = await prisma.user.upsert({
      where: { email: "director.environment@nairobi.go.ke" },
      update: {
        displayName: "Director of Environment",
        passwordHash: hashPassword("Director@Nairobi2026!Ops"),
        active: true,
        mustChangePassword: false,
      },
      create: {
        email: "director.environment@nairobi.go.ke",
        displayName: "Director of Environment",
        passwordHash: hashPassword("Director@Nairobi2026!Ops"),
        active: true,
        mustChangePassword: false,
      },
    });
    await prisma.roleAssignment.deleteMany({ where: { userId: directorUser.id } });
    await prisma.scopeAssignment.deleteMany({ where: { userId: directorUser.id } });
    await prisma.roleAssignment.create({ data: { userId: directorUser.id, roleId: directorRole.id } });
    await prisma.scopeAssignment.create({
      data: { userId: directorUser.id, scopeType: "COUNTY", countyId: county.id },
    });
  }

  console.log("Seed complete: capabilities, roles, 17 subcounties, 85 wards, and test officer accounts.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
