export const debateStepModelKeys = [
  "opening",
  "crossExamination",
  "rebuttal",
  "closing",
  "judge"
] as const;

export type DebateStepModelKey = (typeof debateStepModelKeys)[number];

export type DebateStepModelSelections = Record<DebateStepModelKey, string>;

export type PartialDebateStepModelSelections = Partial<DebateStepModelSelections>;

export const debateStepModelLabels: Record<DebateStepModelKey, string> = {
  opening: "Opening",
  crossExamination: "Tough Questions",
  rebuttal: "Comeback",
  closing: "Last Word",
  judge: "Judge"
};

export function resolveDebateStepModelDefaults(
  env: Partial<NodeJS.ProcessEnv> = process.env
): DebateStepModelSelections {
  const economical = env.POLYVISE_QUICK_MODEL?.trim() || "openai/gpt-4o-mini";
  const stronger = env.POLYVISE_DEEP_MODEL?.trim() || "openai/gpt-4.1";

  return {
    opening: env.POLYVISE_OPENING_MODEL?.trim() || economical,
    crossExamination: env.POLYVISE_CROSS_EXAMINATION_MODEL?.trim() || economical,
    rebuttal: env.POLYVISE_REBUTTAL_MODEL?.trim() || stronger,
    closing: env.POLYVISE_CLOSING_MODEL?.trim() || stronger,
    judge: env.POLYVISE_JUDGE_MODEL?.trim() || stronger
  };
}

export function resolveDebateStepModels(
  requested: PartialDebateStepModelSelections | undefined,
  defaults = resolveDebateStepModelDefaults()
): DebateStepModelSelections {
  return Object.fromEntries(
    debateStepModelKeys.map((key) => [key, requested?.[key]?.trim() || defaults[key]])
  ) as DebateStepModelSelections;
}
