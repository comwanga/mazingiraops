import { z } from "zod";
import {
  employeeNumberSchema,
  idSchema,
  isoDateSchema,
  optionalPaginationSchema,
  strictBooleanSchema,
} from "./common";

export const SESSION_DURATIONS = [30, 60, 120, 240, 480] as const;

export const createAttendanceSessionSchema = z.object({
  wardId: idSchema,
  workDate: isoDateSchema.optional(),
  activity: z.string().trim().min(1).max(160),
  location: z.string().trim().min(1).max(160),
  durationMinutes: z
    .number()
    .int()
    .refine((v) => (SESSION_DURATIONS as readonly number[]).includes(v), {
      message: "Duration must be one of 30, 60, 120, 240 or 480 minutes",
    }),
});

export const extendAttendanceSessionSchema = z.object({
  extensionMinutes: z.number().int().refine((value) => [30, 60, 120].includes(value), {
    message: "Extension must be 30, 60 or 120 minutes",
  }),
});

export const checkInSchema = z
  .object({
    sessionToken: z.string().min(16),
    employeeNumber: employeeNumberSchema,
    attendanceIntent: z.enum(["PRESENT", "ABSENT"]).default("PRESENT"),
    absenceReason: z.enum(["SICK_OFF", "WEEKEND_OFF_DUTY"]).optional(),
    latitude: z.number().min(-90).max(90).optional().nullable(),
    longitude: z.number().min(-180).max(180).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.attendanceIntent === "ABSENT" && !value.absenceReason) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["absenceReason"], message: "Select an absence reason" });
    }
    if (value.attendanceIntent === "PRESENT" && value.absenceReason) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["absenceReason"], message: "Absence reason is only valid when absent" });
    }
  });

export const reviewAttendanceAbsenceSchema = z
  .object({
    action: z.enum(["APPROVE", "REJECT"]),
    expectedVersion: z.number().int().positive(),
    reviewNote: z.string().trim().max(2000).default(""),
  })
  .refine((value) => value.action !== "REJECT" || value.reviewNote.length >= 5, {
    path: ["reviewNote"],
    message: "Explain why the absence declaration is rejected",
  });

export const manualAttendanceSchema = z.object({
  sessionId: idSchema,
  employeeId: idSchema,
  status: z.enum(["PRESENT", "ABSENT", "OFF_DUTY", "SICK_OFF"]),
  reason: z.string().trim().min(5),
  workDate: isoDateSchema,
});

export const correctAttendanceSchema = z.object({
  sessionId: idSchema,
  status: z.enum(["PRESENT", "LATE", "ABSENT", "OFF_DUTY", "SICK_OFF"]),
  reason: z.string().trim().min(5).max(2000),
});

export const attendanceQuerySchema = optionalPaginationSchema.extend({
  wardId: idSchema.optional(),
  sessionId: idSchema.optional(),
  employeeId: idSchema.optional(),
  workDate: isoDateSchema.optional(),
  status: z.enum(["PRESENT", "LATE", "ABSENT", "OFF_DUTY", "SICK_OFF", "LEAVE", "OFFICIAL_DUTY"]).optional(),
  active: strictBooleanSchema.optional(),
});

export const rosterQuerySchema = z.object({
  wardId: idSchema,
  workDate: isoDateSchema.optional(),
  sessionId: idSchema.optional(),
});

export type CreateAttendanceSessionInput = z.infer<typeof createAttendanceSessionSchema>;
export type ExtendAttendanceSessionInput = z.infer<typeof extendAttendanceSessionSchema>;
export type CheckInInput = z.infer<typeof checkInSchema>;
export type ReviewAttendanceAbsenceInput = z.infer<typeof reviewAttendanceAbsenceSchema>;
export type ManualAttendanceInput = z.infer<typeof manualAttendanceSchema>;
export type CorrectAttendanceInput = z.infer<typeof correctAttendanceSchema>;
export type AttendanceQueryInput = z.infer<typeof attendanceQuerySchema>;
export type RosterQueryInput = z.infer<typeof rosterQuerySchema>;
