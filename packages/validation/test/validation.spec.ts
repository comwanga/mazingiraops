import { describe, expect, it } from "vitest";
import { employeeNumberSchema, kenyanPhoneSchema } from "../src/common";
import { createWorkLogSchema } from "../src/work-log";
import { createAbsenceSchema } from "../src/absence";
import { createEmployeeSchema, createEmployeeAssignmentSchema } from "../src/staff";
import {
  createAttendanceSessionSchema,
  checkInSchema,
  extendAttendanceSessionSchema,
  manualAttendanceSchema,
  reviewAttendanceAbsenceSchema,
  rosterQuerySchema,
} from "../src/attendance";

describe("employeeNumberSchema", () => {
  it("accepts an 11-digit year-prefixed ID", () => {
    expect(employeeNumberSchema.parse("20230464669")).toBe("20230464669");
  });

  it("rejects malformed IDs", () => {
    expect(() => employeeNumberSchema.parse("NCC-1042")).toThrow();
    expect(() => employeeNumberSchema.parse("12345")).toThrow();
  });
});

describe("kenyanPhoneSchema", () => {
  it("normalizes a 0-prefixed number", () => {
    expect(kenyanPhoneSchema.parse("0712345601")).toBe("0712345601");
  });

  it("accepts a +254 number", () => {
    expect(kenyanPhoneSchema.parse("+254712345601")).toBe("+254712345601");
  });

  it("rejects non-Kenyan numbers", () => {
    expect(() => kenyanPhoneSchema.parse("12345")).toThrow();
  });
});

describe("createWorkLogSchema", () => {
  const base = {
    wardId: "clh00000000000000000000000",
    workDate: "2026-08-15",
    activity: "Drainage clearing",
    location: "Makina Market",
    areasRoads: "Mashinani Road",
    description: "Cleared blocked drainage",
    truthConfirmed: true,
  };

  it("accepts a valid work log", () => {
    expect(createWorkLogSchema.parse(base).numberOfTrips).toBe(0);
  });

  it("accepts a UUID idempotency key and rejects malformed submission keys", () => {
    expect(createWorkLogSchema.parse({
      ...base,
      clientSubmissionId: "58c9e6e8-2eff-46e7-8c67-9acd845665cb",
    }).clientSubmissionId).toBe("58c9e6e8-2eff-46e7-8c67-9acd845665cb");
    expect(() => createWorkLogSchema.parse({ ...base, clientSubmissionId: "repeat-click" })).toThrow();
  });

  it("requires the officer's truth confirmation", () => {
    expect(() => createWorkLogSchema.parse({ ...base, truthConfirmed: false })).toThrow();
  });

  it("rejects an invalid truck identifier", () => {
    expect(() =>
      createWorkLogSchema.parse({
        ...base,
        wasteTransferInvolved: true,
        numberOfTrips: 2,
        truckId: "161",
      }),
    ).toThrow();
  });

  it("requires a truck/backhoe when waste transfer is involved", () => {
    expect(() =>
      createWorkLogSchema.parse({
        ...base,
        wasteTransferInvolved: true,
        numberOfTrips: 2,
      }),
    ).toThrow();
  });

  it("requires outstanding work for incomplete work", () => {
    expect(() =>
      createWorkLogSchema.parse({ ...base, completionStatus: "INCOMPLETE" }),
    ).toThrow();
  });

  it("rejects impossible calendar dates and permissive booleans", () => {
    expect(() => createWorkLogSchema.parse({ ...base, workDate: "2026-02-30" })).toThrow();
    expect(() => createWorkLogSchema.parse({ ...base, wasteTransferInvolved: "yes" })).toThrow();
    expect(createWorkLogSchema.parse({ ...base, cleanupDone: "false" }).cleanupDone).toBe(false);
  });
});

describe("createAbsenceSchema", () => {
  const base = {
    employeeId: "clh00000000000000000000001",
    kind: "ANNUAL_LEAVE",
    startDate: "2026-08-15",
    endDate: "2026-08-16",
    returnDate: "2026-08-17",
  };

  it("accepts valid leave", () => {
    const parsed = createAbsenceSchema.parse(base);
    expect(parsed.planned).toBe(false);
    expect(parsed.reason).toBe("");
  });

  it("rejects return date before end date", () => {
    expect(() =>
      createAbsenceSchema.parse({ ...base, returnDate: "2026-08-15" }),
    ).toThrow();
  });

  it("requires a sufficient sick-off reason", () => {
    expect(() =>
      createAbsenceSchema.parse({ ...base, kind: "SICK_OFF", reason: "sick" }),
    ).toThrow();
  });
});

describe("createEmployeeSchema", () => {
  const base = {
    employeeNumber: "20230464669",
    fullName: "John Makina",
    phone: "0712345601",
    wardId: "clh00000000000000000000000",
  };

  it("accepts a valid employee", () => {
    const parsed = createEmployeeSchema.parse(base);
    expect(parsed.designation).toBe("Green Army Staff");
    expect(parsed.rosterStatus).toBe("ON_DUTY");
  });

  it("rejects an invalid employee number", () => {
    expect(() =>
      createEmployeeSchema.parse({ ...base, employeeNumber: "NCC-1042" }),
    ).toThrow();
  });

  it("rejects a non-Kenyan phone", () => {
    expect(() =>
      createEmployeeSchema.parse({ ...base, phone: "12345" }),
    ).toThrow();
  });
});

describe("createEmployeeAssignmentSchema", () => {
  it("requires a ward id", () => {
    expect(() => createEmployeeAssignmentSchema.parse({ wardId: "nope" })).toThrow();
    expect(createEmployeeAssignmentSchema.parse({ wardId: "clh00000000000000000000000" }).wardId).toBe(
      "clh00000000000000000000000",
    );
  });
});

describe("createAttendanceSessionSchema", () => {
  const base = {
    wardId: "clh00000000000000000000000",
    activity: "Drainage",
    location: "Makina Market",
    durationMinutes: 120,
  };

  it("accepts a valid session", () => {
    expect(createAttendanceSessionSchema.parse(base).workDate).toBeUndefined();
  });

  it("rejects an unsupported duration", () => {
    expect(() =>
      createAttendanceSessionSchema.parse({ ...base, durationMinutes: 90 }),
    ).toThrow();
  });
});

describe("extendAttendanceSessionSchema", () => {
  it("accepts bounded extensions and rejects arbitrary durations", () => {
    expect(extendAttendanceSessionSchema.parse({ extensionMinutes: 30 }).extensionMinutes).toBe(30);
    expect(() => extendAttendanceSessionSchema.parse({ extensionMinutes: 480 })).toThrow();
  });
});

describe("checkInSchema", () => {
  it("accepts a valid check-in", () => {
    const parsed = checkInSchema.parse({
      sessionToken: "0123456789abcdef0123456789abcdef",
      employeeNumber: "20230464669",
      latitude: -1.3,
      longitude: 36.8,
    });
    expect(parsed.employeeNumber).toBe("20230464669");
  });

  it("rejects an invalid employee number", () => {
    expect(() =>
      checkInSchema.parse({
        sessionToken: "0123456789abcdef0123456789abcdef",
        employeeNumber: "123",
      }),
    ).toThrow();
  });

  it("rejects out-of-range coordinates", () => {
    expect(() =>
      checkInSchema.parse({
        sessionToken: "0123456789abcdef0123456789abcdef",
        employeeNumber: "20230464669",
        latitude: 200,
      }),
    ).toThrow();
  });

  it("requires a reason for an employee absence declaration", () => {
    const base = {
      sessionToken: "0123456789abcdef0123456789abcdef",
      employeeNumber: "20230464669",
      attendanceIntent: "ABSENT",
    };
    expect(() => checkInSchema.parse(base)).toThrow();
    expect(checkInSchema.parse({ ...base, absenceReason: "WEEKEND_OFF_DUTY" }).absenceReason)
      .toBe("WEEKEND_OFF_DUTY");
  });
});

describe("reviewAttendanceAbsenceSchema", () => {
  it("requires a rejection explanation but permits approval without one", () => {
    expect(reviewAttendanceAbsenceSchema.parse({ action: "APPROVE", expectedVersion: 1 }).action)
      .toBe("APPROVE");
    expect(() => reviewAttendanceAbsenceSchema.parse({ action: "REJECT", expectedVersion: 1 }))
      .toThrow();
  });
});

describe("manualAttendanceSchema", () => {
  const base = {
    sessionId: "clh00000000000000000000002",
    employeeId: "clh00000000000000000000001",
    status: "PRESENT",
    reason: "Supervisor verified attendance",
    workDate: "2026-08-15",
  };

  it("accepts a valid manual record", () => {
    expect(manualAttendanceSchema.parse(base).status).toBe("PRESENT");
  });

  it("rejects a status outside the manual set", () => {
    expect(() =>
      manualAttendanceSchema.parse({ ...base, status: "LATE" }),
    ).toThrow();
  });

  it("requires a reason of at least 5 characters", () => {
    expect(() => manualAttendanceSchema.parse({ ...base, reason: "nope" })).toThrow();
  });
});

describe("rosterQuerySchema", () => {
  it("requires a ward and accepts an optional date", () => {
    expect(() => rosterQuerySchema.parse({ workDate: "2026-08-15" })).toThrow();
    expect(
      rosterQuerySchema.parse({ wardId: "clh00000000000000000000000" }).workDate,
    ).toBeUndefined();
  });
});
