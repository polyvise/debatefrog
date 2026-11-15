import { readingLevels, type ReadingLevel } from "@/lib/reading-level";
import type { DebateRequest } from "@/lib/polyvise-api/types";
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

/**
 * Debatefrog's own request fields. The shared ones (subject, context,
 * evidence, council size, dev options) pass through untouched: the Polyvise
 * API validates them when it seeds the record.
 */
export const debatefrogRequestSchema = z
  .object({
    mode: z.literal("hybrid_council").optional(),
    readingLevel: z.enum(readingLevels).optional(),
    models: debatefrogModelSelectionSchema
  })
  .passthrough();

export type DebatefrogRequest = Omit<DebateRequest, "models"> & {
  readingLevel?: ReadingLevel;
  models?: PartialDebateStepModelSelections & {
    yes?: string;
    no?: string;
    quick?: string;
    deep?: string;
  };
};

/** The shared part of a request, as sent to the API. Debatefrog always runs a cited Hybrid Council. */
export function toCoreDebateRequest(request: DebatefrogRequest) {
  return {
    subject: request.subject,
    context: request.context,
    mode: "hybrid_council" as const,
    evidence: request.evidence ?? ("cited" as const),
    councilSize: request.councilSize ?? ("quartet" as const),
    devOptions: request.devOptions
  };
}
