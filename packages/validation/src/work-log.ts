import { z } from "zod";
import { idSchema, isoDateSchema, optionalPaginationSchema, strictBooleanSchema } from "./common";

export const createWorkLogSchema = z
  .object({
    wardId: z.string().cuid(),
    workDate: isoDateSchema,
    activity: z.string().trim().min(3).max(160),
    location: z.string().trim().min(3).max(160),
    areasRoads: z.string().trim().min(3),
    description: z.string().trim().min(3),
    numberOfTrips: z.coerce.number().int().min(0).default(0),
    wasteTransferInvolved: strictBooleanSchema.default(false),
    truckId: z.string().trim().toUpperCase().default(""),
    backhoeId: z.string().trim().toUpperCase().default(""),
    staffCount: z.coerce.number().int().min(0).default(0),
    challenges: z.string().trim().max(2000).optional().nullable(),
    suggestedSolutions: z.string().trim().max(2000).optional().nullable(),
    truthConfirmed: strictBooleanSchema.refine((value) => value, {
      message: "Confirm that the submitted work-log information is true",
    }),
    clientSubmissionId: z.string().uuid().optional(),
    cleanupDone: strictBooleanSchema.default(false),
    cleanupStakeholders: z.string().trim().max(2000).default(""),
    climateTeamCount: z.coerce.number().int().min(0).default(0),
    completionStatus: z.enum(["COMPLETE", "INCOMPLETE"]).default("COMPLETE"),
    outstandingWork: z.string().trim().max(2000).default(""),
  })
  .refine((v) => !v.truckId || /^T-\d+$/.test(v.truckId), {
    message: "Truck identification must use the format T-161",
  })
  .refine((v) => !v.backhoeId || /^BH\d+$/.test(v.backhoeId), {
    message: "Backhoe identification must use the format BH13",
  })
  .refine(
    (v) => !v.wasteTransferInvolved || (v.numberOfTrips >= 1 && (!!v.truckId || !!v.backhoeId)),
    { message: "Waste transfer requires at least one trip and a truck or backhoe identification number" },
  )
  .refine((v) => !v.cleanupDone || (v.cleanupStakeholders.trim() || v.climateTeamCount > 0), {
    message: "Record the cleanup stakeholders or the number of Climate Works team members",
  })
  .refine((v) => v.completionStatus !== "INCOMPLETE" || v.outstandingWork.trim().length >= 5, {
    message: "Describe the outstanding work for an incomplete activity",
  });

export const workLogActionSchema = z.object({
  action: z.enum(["SUBMIT", "APPROVE", "REJECT"]),
  expectedVersion: z.number().int().positive(),
  reviewNote: z.string().trim().max(2000).default(""),
});

export const workLogQuerySchema = optionalPaginationSchema.extend({
  wardId: idSchema.optional(),
  workDate: isoDateSchema.optional(),
  status: z.enum(["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"]).optional(),
});

export type CreateWorkLogInput = z.infer<typeof createWorkLogSchema>;
export type WorkLogActionInput = z.infer<typeof workLogActionSchema>;
export type WorkLogQueryInput = z.infer<typeof workLogQuerySchema>;
