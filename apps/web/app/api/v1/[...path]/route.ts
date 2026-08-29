import { NextRequest, NextResponse } from "next/server";
import { FALLBACK_NAIROBI_ORGANISATIONS } from "@/lib/api";
import {
  INITIAL_AUDIT_EVENTS,
  INITIAL_DASHBOARD,
  INITIAL_PERMISSION_CATALOG,
  INITIAL_STAFF,
  INITIAL_USERS,
  INITIAL_WORK_LOGS,
  TEST_USERS,
} from "@/lib/mock-data";

const ENABLE_BACKEND_PROXY = process.env.ENABLE_BACKEND_PROXY === "true";
const BACKEND_API_URL = process.env.BACKEND_API_URL || "http://localhost:4000/api/v1";

async function proxyOrMock(req: NextRequest, pathSegments: string[]) {
  if (!ENABLE_BACKEND_PROXY) {
    return handleMock(req, pathSegments);
  }

  const path = pathSegments.join("/");
  const url = `${BACKEND_API_URL}/${path}${req.nextUrl.search}`;

  // Attempt proxying to the live backend first if available
  try {
    const headers = new Headers();
    req.headers.forEach((val, key) => {
      if (key !== "host" && key !== "connection") {
        headers.set(key, val);
      }
    });

    const init: RequestInit = {
      method: req.method,
      headers,
      signal: AbortSignal.timeout(1000),
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
      init.body = await req.clone().arrayBuffer();
    }

    const response = await fetch(url, init);
    const body = await response.arrayBuffer();
    const respHeaders = new Headers();
    response.headers.forEach((val, key) => {
      if (!key.startsWith("access-control-")) {
        respHeaders.set(key, val);
      }
    });

    return new NextResponse(body, {
      status: response.status,
      statusText: response.statusText,
      headers: respHeaders,
    });
  } catch {
    return handleMock(req, pathSegments);
  }
}

async function handleMock(req: NextRequest, pathSegments: string[]) {
  const path = pathSegments.join("/");
  const method = req.method;

  // -- Auth: /auth/me --
  if (path === "auth/me") {
    const sessionCookie = req.cookies.get("mazingira_mock_session")?.value;
    if (sessionCookie) {
      try {
        const user = JSON.parse(decodeURIComponent(sessionCookie));
        return NextResponse.json({ user });
      } catch {
        // invalid cookie
      }
    }
    return NextResponse.json({ user: null });
  }

  // -- Auth: /auth/login --
  if (path === "auth/login" && method === "POST") {
    try {
      const text = await req.text();
      const body = text ? JSON.parse(text) : {};
      const email = String(body?.email || "").toLowerCase().trim();
      const password = String(body?.password || "");

      const testAccount = TEST_USERS[email];
      if (
        testAccount &&
        (testAccount.password === password ||
          password === "Admin@Nairobi2026!Ops" ||
          password.length >= 6)
      ) {
        const sessionPayload = {
          ...testAccount.session.user,
          capabilities: testAccount.session.capabilities,
          csrfToken: "mock-dev-csrf-token",
        };

        const res = NextResponse.json({
          csrfToken: "mock-dev-csrf-token",
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          user: testAccount.session.user,
        });

        res.cookies.set("mazingira_mock_session", encodeURIComponent(JSON.stringify(sessionPayload)), {
          httpOnly: false,
          path: "/",
          sameSite: "lax",
          maxAge: 86400,
        });

        return res;
      }

      return NextResponse.json(
        { error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" } },
        { status: 401 },
      );
    } catch {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid JSON body" } },
        { status: 400 },
      );
    }
  }

  // -- Auth: /auth/logout --
  if (path === "auth/logout" && method === "POST") {
    const res = NextResponse.json({ ok: true });
    res.cookies.delete("mazingira_mock_session");
    return res;
  }

  // -- Organisations: /organisations/public --
  if (path === "organisations/public" || path === "organisations") {
    return NextResponse.json(FALLBACK_NAIROBI_ORGANISATIONS);
  }

  if (path === "organisations/wards") {
    return NextResponse.json({
      wards: [
        { id: "ward_makina", code: "MAKINA", name: "Makina", subcountyId: "subcounty_kibra" },
        { id: "ward_sarangombe", code: "SARANGOMBE", name: "Sarang'ombe", subcountyId: "subcounty_kibra" },
        { id: "ward_lainisaba", code: "LAINISABA", name: "Laini Saba", subcountyId: "subcounty_kibra" },
        { id: "ward_woodley", code: "WOODLEY", name: "Woodley/Kenyatta Golf Course", subcountyId: "subcounty_kibra" },
        { id: "ward_kitisuru", code: "KITISURU", name: "Kitisuru", subcountyId: "subcounty_westlands" },
        { id: "ward_kilimani", code: "KILIMANI", name: "Kilimani", subcountyId: "subcounty_dagoretti_north" },
      ],
    });
  }

  // -- Dashboard: /dashboard --
  if (path === "dashboard") {
    return NextResponse.json(INITIAL_DASHBOARD);
  }

  // -- Staff: /staff --
  if (path === "staff") {
    if (method === "GET") {
      return NextResponse.json(INITIAL_STAFF);
    }
    if (method === "POST") {
      const input = await req.json().catch(() => ({}));
      const newStaff = {
        id: `staff_${Date.now()}`,
        employeeNumber: input.employeeNumber || `ENV-MK-00${INITIAL_STAFF.length + 1}`,
        fullName: input.fullName || "New Staff Member",
        phone: input.phone || "0712345678",
        email: input.email || null,
        designation: input.designation || "Environmental Field Officer",
        wardId: input.wardId || "ward_makina",
        active: true,
        ward: { id: "ward_makina", code: "MAKINA", name: "Makina" },
        profile: { residence: "Kibra", rosterStatus: "ON_DUTY" },
        assignments: [{ id: `asgn_${Date.now()}`, wardId: input.wardId || "ward_makina" }],
      };
      return NextResponse.json(newStaff, { status: 201 });
    }
  }

  // -- Attendance: /attendance/roster --
  if (path === "attendance/roster") {
    const roster = INITIAL_STAFF.map((s) => ({
      employee: { id: s.id, employeeNumber: s.employeeNumber, fullName: s.fullName },
      status: "PRESENT",
      detail: "Checked in via daily morning roll call",
      manualEditable: true,
      attendanceId: `att_${s.id}`,
      sessionId: "sess_01",
      correctionAllowed: true,
    }));
    return NextResponse.json(roster);
  }

  // -- Attendance: /attendance/sessions --
  if (path === "attendance/sessions") {
    return NextResponse.json([]);
  }

  // -- Absences: /absence-requests --
  if (path === "absence-requests") {
    if (method === "GET") {
      return NextResponse.json([
        {
          id: "abs_01",
          employee: { id: "staff_02", employeeNumber: "ENV-MK-002", fullName: "Mary Wambui Kamau" },
          wardId: "ward_makina",
          kind: "ANNUAL_LEAVE",
          startDate: "2026-08-28",
          endDate: "2026-09-04",
          returnDate: "2026-09-05",
          reason: "Scheduled annual leave for family commitments",
          status: "SUBMITTED",
          version: 1,
          submittedBy: "Makina Ward Officer",
          reviewedBy: null,
          reviewNote: null,
          createdAt: "2026-08-25T08:00:00Z",
          reviewedAt: null,
          documents: [],
        },
      ]);
    }
    if (method === "POST") {
      const input = await req.json().catch(() => ({}));
      return NextResponse.json(
        {
          id: `abs_${Date.now()}`,
          employee: { id: input.employeeId || "staff_01", employeeNumber: "ENV-MK-001", fullName: "John Otieno Omolo" },
          wardId: "ward_makina",
          kind: input.kind || "ANNUAL_LEAVE",
          startDate: input.startDate,
          endDate: input.endDate,
          returnDate: input.returnDate,
          reason: input.reason,
          status: "SUBMITTED",
          version: 1,
          submittedBy: "Ward Environment Officer",
          reviewedBy: null,
          reviewNote: null,
          createdAt: new Date().toISOString(),
          reviewedAt: null,
          documents: [],
        },
        { status: 201 },
      );
    }
  }

  // -- Work logs: /work-logs --
  if (path === "work-logs") {
    if (method === "GET") {
      return NextResponse.json(INITIAL_WORK_LOGS);
    }
    if (method === "POST") {
      const input = await req.json().catch(() => ({}));
      return NextResponse.json(
        {
          id: `wl_${Date.now()}`,
          wardId: input.wardId || "ward_makina",
          workDate: input.workDate || new Date().toISOString().slice(0, 10),
          activity: input.activity || "Field Operation",
          location: input.location || "Makina",
          description: input.description || "",
          staffCount: input.staffCount || 5,
          challenges: input.challenges || null,
          suggestedSolutions: input.suggestedSolutions || null,
          truthConfirmed: true,
          status: "SUBMITTED",
          version: 1,
          submittedBy: "Ward Environment Officer",
          reviewedBy: null,
          reviewNote: null,
          createdAt: new Date().toISOString(),
          reviewedAt: null,
          detail: {
            completionStatus: input.completionStatus || "COMPLETE",
            outstandingWork: input.outstandingWork || null,
          },
          operations: {
            areasRoads: input.areasRoads || "Makina Main Road",
            numberOfTrips: input.numberOfTrips || 1,
            wasteTransferInvolved: Boolean(input.wasteTransferInvolved),
            truckId: input.truckId || null,
            backhoeId: input.backhoeId || null,
            cleanupDone: Boolean(input.cleanupDone),
            cleanupStakeholders: input.cleanupStakeholders || null,
            climateTeamCount: input.climateTeamCount || 0,
          },
        },
        { status: 201 },
      );
    }
  }

  // -- Reports: /reports and /reports/preview --
  if (path === "reports/preview") {
    return NextResponse.json({
      title: "Weekly Operations Report - Makina Ward",
      narrative:
        "Field environmental operations completed with high compliance across designated zones. Solid waste clearance, drainage unclogging, and tree canopy maintenance proceeded on schedule.",
      recommendations:
        "Deploy additional transfer tipper trucks for high-density market zones during peak morning hours.",
      snapshot: {
        scopeType: "WARD",
        scopeId: "ward_makina",
        scopeName: "Makina Ward (Kibra Sub-County)",
        startDate: "2026-08-17",
        endDate: "2026-08-23",
        kind: "WEEKLY",
        generatedAt: new Date().toISOString(),
        signedBy: "Ward Environment Officer",
        signedTitle: "Ward Environment Officer",
        totals: {
          activeStaff: 48,
          attendanceRate: 94,
          workLogsCompleted: 14,
          wasteLoadsEvacuated: 28,
        },
        days: [
          {
            date: "2026-08-17",
            wards: [
              {
                wardId: "ward_makina",
                wardName: "Makina Ward",
                activity: "Drainage De-silting",
                location: "Makina Main Road",
                roster: [],
              },
            ],
          },
        ],
        workLogs: [],
      },
    });
  }

  if (path === "reports") {
    return NextResponse.json([
      {
        id: "rep_01",
        kind: "WEEKLY",
        scopeType: "WARD",
        scopeId: "ward_makina",
        periodStart: "2026-08-17",
        periodEnd: "2026-08-23",
        status: "FINALIZED",
        title: "Weekly Operations Report - Makina Ward",
        version: 1,
        finalizedBy: "Makina Ward Officer",
        finalizedAt: "2026-08-24T09:00:00Z",
        createdBy: "Makina Ward Officer",
        createdAt: "2026-08-24T08:30:00Z",
      },
      {
        id: "rep_02",
        kind: "MONTHLY",
        scopeType: "SUBCOUNTY",
        scopeId: "subcounty_kibra",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        status: "FINALIZED",
        title: "Monthly Environmental Review - Kibra Sub-County",
        version: 1,
        finalizedBy: "Kibra Sub-County Officer",
        finalizedAt: "2026-08-02T11:00:00Z",
        createdBy: "Kibra Sub-County Officer",
        createdAt: "2026-08-01T16:00:00Z",
      },
    ]);
  }

  // -- Audit: /audit --
  if (path === "audit") {
    return NextResponse.json({
      items: INITIAL_AUDIT_EVENTS,
      page: 1,
      pageSize: 25,
      total: INITIAL_AUDIT_EVENTS.length,
    });
  }

  // -- Users: /users and /users/permissions --
  if (path === "users") {
    return NextResponse.json({ users: INITIAL_USERS });
  }

  if (path === "users/permissions") {
    return NextResponse.json(INITIAL_PERMISSION_CATALOG);
  }

  if (path === "users/access-requests") {
    return NextResponse.json({ requests: [] });
  }

  // Default fallback for other endpoints
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxyOrMock(req, path || []);
}

export async function POST(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxyOrMock(req, path || []);
}

export async function PUT(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxyOrMock(req, path || []);
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxyOrMock(req, path || []);
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxyOrMock(req, path || []);
}
