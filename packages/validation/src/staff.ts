import { z } from "zod";
import {
  employeeNumberSchema,
  idSchema,
  kenyanPhoneSchema,
  optionalPaginationSchema,
  strictBooleanSchema,
} from "./common";

export const createEmployeeSchema = z.object({
  employeeNumber: employeeNumberSchema,
  fullName: z.string().trim().min(3).max(120),
  phone: kenyanPhoneSchema,
  email: z.string().trim().toLowerCase().email().max(160).optional().nullable(),
  designation: z.string().trim().min(2).max(80).default("Green Army Staff"),
  residence: z.string().trim().max(160).optional().nullable(),
  rosterStatus: z.enum(["ON_DUTY", "ANNUAL_LEAVE"]).default("ON_DUTY"),
  wardId: idSchema,
});

export const updateEmployeeSchema = createEmployeeSchema
  .omit({ wardId: true })
  .partial();

export const createEmployeeAssignmentSchema = z.object({
  wardId: idSchema,
  type: z.enum(["TEMPORARY", "TRANSFER"]).default("TEMPORARY"),
});

export const staffQuerySchema = optionalPaginationSchema.extend({
  wardId: idSchema.optional(),
  active: strictBooleanSchema.optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

export const staffImportRowSchema = createEmployeeSchema.omit({ wardId: true });

export const commitStaffImportSchema = z.object({
  wardId: idSchema,
  sourceName: z.string().trim().min(1).max(200).optional(),
  duplicateStrategy: z.enum(["SKIP", "UPDATE"]).default("SKIP"),
  rows: z.array(staffImportRowSchema).min(1).max(2000),
});

export const staffImportPreviewMetaSchema = z.object({ wardId: idSchema });

export const staffImportHistoryQuerySchema = optionalPaginationSchema;

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
export type CreateEmployeeAssignmentInput = z.infer<typeof createEmployeeAssignmentSchema>;
export type StaffQueryInput = z.infer<typeof staffQuerySchema>;
export type StaffImportRowInput = z.infer<typeof staffImportRowSchema>;
export type CommitStaffImportInput = z.infer<typeof commitStaffImportSchema>;
export type StaffImportHistoryQueryInput = z.infer<typeof staffImportHistoryQuerySchema>;
