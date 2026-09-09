import { debateRequestSchema } from "@polyvise/core/debate/schema";
import type { DebateRequest } from "@polyvise/core/debate/types";
import { z } from "zod";
import type { PartialDebateStepModelSelections } from "@/lib/debate-step-models";

const modelSlotSchema = z.string().trim().min(1).max(120).optional();

const debatefrogModelSelectionSchema = z
  .object({
    opening: modelSlotSchema,
    crossExamination: modelSlotSchema,
    rebuttal: modelSlotSchema,
    closing: modelSlotSchema,
    judge: modelSlotSchema,
    // Accepted during the model-settings migration. New clients send only
    // mirrored per-round choices.
    yes: modelSlotSchema,
    no: modelSlotSchema,
    quick: modelSlotSchema,
    deep: modelSlotSchema
  })
  .partial()
  .optional();

export const debatefrogRequestSchema = debateRequestSchema.extend({
  mode: z.literal("hybrid_council").optional(),
  models: debatefrogModelSelectionSchema
});

export type DebatefrogRequest = Omit<DebateRequest, "models"> & {
  models?: PartialDebateStepModelSelections & {
    yes?: string;
    no?: string;
    quick?: string;
    deep?: string;
  };
};

export type NormalizedCoreDebateRequest = DebateRequest & {
  mode: "hybrid_council";
  evidence: "cited";
  councilSize: "duo" | "quartet";
};

export function toCoreDebateRequest(request: DebatefrogRequest): NormalizedCoreDebateRequest {
  return {
    subject: request.subject,
    context: request.context,
    mode: "hybrid_council",
    evidence: request.evidence ?? "cited",
    councilSize: request.councilSize ?? "quartet",
    devOptions: request.devOptions
  };
}
