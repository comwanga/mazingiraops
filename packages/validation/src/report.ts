import { z } from "zod";
import { idSchema, isoDateSchema, paginationSchema, scopeTypeSchema } from "./common";

export const MAX_REPORT_SPAN_DAYS = 366;

export const reportKindSchema = z.enum(["DAILY", "WEEKLY", "MONTHLY", "CUSTOM"]);

const reportPeriodFields = {
  scopeType: scopeTypeSchema,
  scopeId: idSchema,
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  kind: reportKindSchema,
};

export const reportPreviewQuerySchema = z
  .object(reportPeriodFields)
  .superRefine((value, ctx) => {
    if (value.endDate < value.startDate) {
      ctx.addIssue({ path: ["endDate"], code: "custom", message: "End date cannot be before the start date" });
    }
    const spanDays =
      (Date.parse(`${value.endDate}T00:00:00Z`) - Date.parse(`${value.startDate}T00:00:00Z`)) /
      86_400_000;
    if (spanDays > MAX_REPORT_SPAN_DAYS) {
      ctx.addIssue({
        path: ["endDate"],
        code: "custom",
        message: `Report period cannot exceed ${MAX_REPORT_SPAN_DAYS} days`,
      });
    }
    const maxKindSpan = value.kind === "DAILY" ? 0 : value.kind === "WEEKLY" ? 6 : value.kind === "MONTHLY" ? 31 : MAX_REPORT_SPAN_DAYS;
    if (spanDays > maxKindSpan) {
      ctx.addIssue({
        path: ["endDate"],
        code: "custom",
        message: `${value.kind.toLowerCase()} reports cannot span more than ${maxKindSpan + 1} day(s)`,
      });
    }
  });

export const reportFinalizeSchema = z
  .object({
    ...reportPeriodFields,
    narrative: z.string().trim().max(4000).optional(),
    recommendations: z.string().trim().max(2000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.endDate < value.startDate) {
      ctx.addIssue({ path: ["endDate"], code: "custom", message: "End date cannot be before the start date" });
    }
    const spanDays =
      (Date.parse(`${value.endDate}T00:00:00Z`) - Date.parse(`${value.startDate}T00:00:00Z`)) /
      86_400_000;
    if (spanDays > MAX_REPORT_SPAN_DAYS) {
      ctx.addIssue({
        path: ["endDate"],
        code: "custom",
        message: `Report period cannot exceed ${MAX_REPORT_SPAN_DAYS} days`,
      });
    }
    const maxKindSpan = value.kind === "DAILY" ? 0 : value.kind === "WEEKLY" ? 6 : value.kind === "MONTHLY" ? 31 : MAX_REPORT_SPAN_DAYS;
    if (spanDays > maxKindSpan) {
      ctx.addIssue({
        path: ["endDate"],
        code: "custom",
        message: `${value.kind.toLowerCase()} reports cannot span more than ${maxKindSpan + 1} day(s)`,
      });
    }
  });

export const reportQuerySchema = z.object({
  scopeType: scopeTypeSchema.optional(),
  scopeId: idSchema.optional(),
  kind: reportKindSchema.optional(),
  date: isoDateSchema.optional(),
  ...paginationSchema.shape,
});

export const reportAiDraftSchema = reportPreviewQuerySchema;

export type ReportPreviewQueryInput = z.infer<typeof reportPreviewQuerySchema>;
export type ReportFinalizeInput = z.infer<typeof reportFinalizeSchema>;
export type ReportQueryInput = z.infer<typeof reportQuerySchema>;
export type ReportAiDraftInput = z.infer<typeof reportAiDraftSchema>;
