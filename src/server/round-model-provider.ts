import {
  MockLlmProvider,
  OpenRouterLlmProvider,
  type LlmProvider,
  type LlmRequest
} from "@polyvise/core/providers/llm";
import type { DebateRuntimeConfig } from "@polyvise/core/debate/config";
import type { ModelSnapshot } from "@polyvise/core/debate/types";
import type {
  DebateStepModelKey,
  DebateStepModelSelections
} from "@/lib/debate-step-models";

type StructuredTurn = {
  round?: string;
  content?: string;
  sourceIds?: string[];
};

type StructuredTurnOutput = { turns?: StructuredTurn[] };

export class RoundModelLlmProvider implements LlmProvider {
  readonly name: string;
  readonly configured: boolean;
  private readonly providers = new Map<string, LlmProvider>();

  constructor(
    private readonly config: DebateRuntimeConfig,
    private readonly selections: DebateStepModelSelections
  ) {
    this.name = config.enableMockLlm ? "mock" : "openrouter";
    this.configured = config.enableMockLlm || Boolean(process.env.OPENROUTER_API_KEY);
  }

  modelForRole(role: string): string {
    return this.selections[stepForRole(role)];
  }

  async generateStructured<T>(request: LlmRequest): Promise<{
    data: T;
    snapshot: ModelSnapshot;
  }> {
    const provider = this.providerForModel(this.modelForRole(request.role));
    const prepared = withDebatefrogGenerationRules(request);
    const first = await provider.generateStructured<T>(prepared);
    const issues = semanticOutputIssues(request.schemaName, first.data, prepared.prompt);

    if (issues.length === 0 || this.config.enableMockLlm) {
      return first;
    }

    const repairedRequest = withRepairInstructions(prepared, issues);
    const repaired = await provider.generateStructured<T>(repairedRequest);
    const remainingIssues = semanticOutputIssues(
      request.schemaName,
      repaired.data,
      repairedRequest.prompt
    );

    if (remainingIssues.length > 0) {
      throw new Error(
        `Generated ${request.schemaName} failed semantic validation: ${remainingIssues.join(" ")}`
      );
    }

    return {
      ...repaired,
      snapshot: {
        ...repaired.snapshot,
        attempts: [
          ...(first.snapshot.attempts ?? []),
          ...(repaired.snapshot.attempts ?? [])
        ]
      }
    };
  }

  private providerForModel(model: string): LlmProvider {
    if (this.config.enableMockLlm) {
      return new MockLlmProvider();
    }

    const existing = this.providers.get(model);
    if (existing) return existing;

    const modelConfig: DebateRuntimeConfig = {
      ...this.config,
      quickModel: model,
      deepModel: model,
      yesModel: model,
      noModel: model,
      judgeModel: model
    };
    const provider = new OpenRouterLlmProvider(modelConfig);
    this.providers.set(model, provider);
    return provider;
  }
}

export function stepForRole(role: string): DebateStepModelKey {
  const normalized = role.toLowerCase();
  if (
    normalized.includes("judge") ||
    normalized.includes("summary") ||
    normalized.includes("scorecard")
  ) {
    return "judge";
  }
  if (normalized.includes("cross-examination")) return "crossExamination";
  if (normalized.includes("rebuttal")) return "rebuttal";
  if (normalized.includes("closing")) return "closing";
  return "opening";
}

export function withDebatefrogGenerationRules(request: LlmRequest): LlmRequest {
  const parsed = parsePrompt(request.prompt);
  if (!parsed) return request;

  const existingRules = Array.isArray(parsed.rules)
    ? parsed.rules.filter(
        (rule): rule is string =>
          typeof rule === "string" && !rule.startsWith("Start by naming the opponent's point")
      )
    : [];

  parsed.rules = [
    ...existingRules,
    "The frog is an advocate discussing the debate subject, never the subject itself. First-person words describe the frog's argument only. For a named person, company, country, or organization, use that subject's name or third-person pronouns; never turn the subject's experiences, office, approval, popularity, vote share, or actions into I, me, or my statements.",
    "Use only source ids whose title and snippet directly support the nearby claim. Prefer original pollsters, official records, and primary research over social posts or commentary.",
    "Never compare percentages as a trend unless they measure the same concept, population, and time series. Distinguish job approval, favorability, vote share, policy support, and voting intention.",
    "For a vague empirical trend question, state the operational definition, population, comparison period, and evidence cutoff you are using. Do not pretend that a broad word such as popularity has only one possible measure.",
    "Copy every number exactly as written in a supporting source. Include enough context to identify what the number measures and when it was measured.",
    "Every visible response must end with a complete sentence. Rewrite shorter when needed; never truncate text, a number, or a sentence.",
    ...rulesForSchemaAndRound(request.schemaName, parsed.round)
  ];

  return { ...request, prompt: JSON.stringify(parsed, null, 2) };
}

export function semanticOutputIssues(
  schemaName: string,
  data: unknown,
  prompt: string
): string[] {
  if (schemaName === "finalSummaryOutput") {
    return finalSummaryIssues(data);
  }
  if (schemaName !== "debateTurnOutput") return [];

  const output = data as StructuredTurnOutput;
  if (!Array.isArray(output?.turns)) return ["Return a turns array."];
  const parsedPrompt = parsePrompt(prompt);
  const knownSourceIds = new Set(
    Array.isArray(parsedPrompt?.sources)
      ? parsedPrompt.sources
          .map((source) => (isRecord(source) ? source.id : undefined))
          .filter((id): id is string => typeof id === "string")
      : []
  );
  const sourceTextById = new Map(
    Array.isArray(parsedPrompt?.sources)
      ? parsedPrompt.sources
          .filter(isRecord)
          .map((source) => [
            typeof source.id === "string" ? source.id : "",
            [source.title, source.snippet, source.publisher]
              .filter((value): value is string => typeof value === "string")
              .join(" ")
          ] as const)
          .filter(([id]) => Boolean(id))
      : []
  );
  const issues: string[] = [];

  for (const turn of output.turns) {
    const content = turn.content?.trim() ?? "";
    const round = turn.round ?? (typeof parsedPrompt?.round === "string" ? parsedPrompt.round : "");
    const wordCount = content.split(/\s+/).filter(Boolean).length;
    const minimumWords = round === "cross_examination" ? 12 : round === "opening" ? 28 : 32;

    if (wordCount < minimumWords) {
      issues.push(`${round || "Debate"} turn needs more detail (at least ${minimumWords} words).`);
    }
    if (!/[.!?][\])}'\"]*$/.test(content) || /\b(?:and|because|while|from|to|of|the|a|an|\d+[.]?)$/i.test(content)) {
      issues.push(`${round || "Debate"} turn must end with a complete sentence.`);
    }
    if (round === "cross_examination") {
      const questionMarks = (content.match(/\?/g) ?? []).length;
      if (questionMarks !== 1 || !/\?[\])}'\"]*$/.test(content)) {
        issues.push("Tough Questions must contain exactly one question and end with a question mark.");
      }
    }
    if (
      round === "rebuttal" &&
      /^\s*(?:my opponent asks|the other frog asks|you asked (?:me )?(?:why|how|whether|what))/i.test(
        content
      )
    ) {
      issues.push("Comeback must answer directly instead of restating the opponent's question.");
    }
    if (/\b(?:my|our)\s+(?:approval|job approval|popularity|poll numbers?|vote share|presidency|election victory)\b/i.test(content)) {
      issues.push("The frog must not speak as if it is the named debate subject.");
    }
    for (const sourceId of turn.sourceIds ?? []) {
      if (!knownSourceIds.has(sourceId)) {
        issues.push(`Turn cites unknown source id ${sourceId}.`);
      }
    }
    const percentageClaims = content.match(/\b\d+(?:[.,]\s?\d+)?\s*%/g) ?? [];
    if (percentageClaims.length > 0) {
      const citedSourceText = (turn.sourceIds ?? [])
        .map((sourceId) => sourceTextById.get(sourceId) ?? "")
        .join(" ")
        .replace(/\s+/g, "");
      for (const percentage of percentageClaims) {
        const normalized = percentage.replace(/\s+/g, "");
        if (!citedSourceText.includes(normalized)) {
          issues.push(`Percentage ${normalized} must appear in one of the turn's cited sources.`);
        }
      }
    }
  }

  return [...new Set(issues)];
}

function finalSummaryIssues(data: unknown): string[] {
  if (!isRecord(data)) return ["Return a final summary object."];
  const issues: string[] = [];
  const headline = typeof data.headline === "string" ? data.headline.trim() : "";
  const recommendation =
    typeof data.recommendation === "string" ? data.recommendation.trim() : "";

  if (!headline) issues.push("Final summary needs a headline.");
  if (headline.length > 120) issues.push("Headline must be 120 characters or fewer.");
  if (!recommendation) issues.push("Final summary needs a recommendation.");
  if (recommendation.length > 320) {
    issues.push("Recommendation must be 320 characters or fewer; rewrite it instead of truncating it.");
  }
  if (recommendation && !/[.!?][\])}'\"]*$/.test(recommendation)) {
    issues.push("Recommendation must end with a complete sentence.");
  }

  for (const key of [
    "strongestPro",
    "strongestCon",
    "unresolvedUncertainties",
    "whatWouldChangeMind"
  ]) {
    if (data[key] !== undefined && !Array.isArray(data[key])) {
      issues.push(`${key} must be an array of concise strings.`);
    }
  }

  return issues;
}

function rulesForSchemaAndRound(schemaName: string, round: unknown): string[] {
  if (schemaName === "claimOutput") {
    return [
      "Build two or three distinct, topic-specific claims for this side. Each warrant must explain why the cited evidence supports the claim instead of merely repeating it."
    ];
  }
  if (schemaName === "judgeScorecardOutput" || schemaName === "finalSummaryOutput") {
    return [
      "Identify the strongest point from each frog and the single hinge that decides the result. Explicitly disregard unsupported claims and incompatible statistic comparisons.",
      "Calibrate confidence to evidence quality. Domain-name citations alone, social posts, commentary, or an unexplained percentage do not justify high confidence."
    ];
  }
  if (schemaName !== "debateTurnOutput") return [];

  switch (round) {
    case "opening":
      return [
        "Opening: write about 45 to 80 words. State the position, give two distinct supporting details when evidence allows, and include one honest qualification. Do not discuss the opponent yet."
      ];
    case "cross_examination":
      return [
        "Tough Questions: ask exactly one pointed question. Refer to the opponent's claim in no more than eight words and only when necessary. Do not answer the question or summarize either case."
      ];
    case "rebuttal":
      return [
        "Comeback: answer the opponent's exact question immediately. Refer to the opponent's claim in no more than one short clause. Spend at least two-thirds of the response adding analysis, evidence, a distinction, comparison, or useful concession. Do not begin with 'My opponent asks' or repeat the full question.",
        "Write about 45 to 85 words and explain why the answer changes, or does not change, the overall case."
      ];
    case "closing":
      return [
        "Last Word: write about 45 to 80 words. Name the decision criterion, synthesize the two strongest established points, and answer the opponent's strongest concern without introducing new evidence."
      ];
    default:
      return [];
  }
}

function withRepairInstructions(request: LlmRequest, issues: string[]): LlmRequest {
  const parsed = parsePrompt(request.prompt);
  if (!parsed) return request;
  parsed.semanticRepairRequired = issues;
  parsed.rules = [
    ...(Array.isArray(parsed.rules) ? parsed.rules : []),
    "Rewrite the invalid output completely. Correct every semanticRepairRequired issue while preserving the requested speaker, side, round, claim ids, and valid source ids."
  ];
  return { ...request, prompt: JSON.stringify(parsed, null, 2) };
}

function parsePrompt(prompt: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(prompt);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
