import { audiencePolicy, DEFAULT_READING_LEVEL, type ReadingLevel } from "@/lib/reading-level";
import type { DebateStepModelSelections } from "@/lib/debate-step-models";
import {
  polyviseApiKey,
  type ModelRouting,
  type PromptPolicy,
  type ProviderOptions,
  type RunOptions
} from "./polyvise-api";

/**
 * Debatefrog's product policy, as the data the Polyvise API applies to every
 * model call of a run: which model speaks in each round, and the audience
 * rules added to each prompt. The engine itself stays in the API.
 */

/** Both frogs share one model per round; the judge model also writes the summary. */
export function stepModelRouting(models: DebateStepModelSelections): ModelRouting {
  return {
    rules: [
      { contains: ["judge", "summary", "scorecard"], model: models.judge },
      { contains: ["cross-examination"], model: models.crossExamination },
      { contains: ["rebuttal"], model: models.rebuttal },
      { contains: ["closing"], model: models.closing }
    ],
    defaultModel: models.opening
  };
}

export function debatefrogPromptPolicy(level: ReadingLevel = DEFAULT_READING_LEVEL): PromptPolicy {
  const policy = audiencePolicy(level);
  const judgeRules = [
    "Explain the best reason from each frog and which reason matters most. Ignore claims without evidence and numbers that measure different things. Keep each judge note to one short sentence.",
    "In visible summary copy, call the pro advocate the green frog and the con advocate the pink frog. Avoid abstract pro/con terminology."
  ];
  const confidenceRule =
    "Calibrate confidence to evidence quality. Domain-name citations alone, social posts, commentary, or an unexplained percentage do not justify high confidence.";

  return {
    removeRulesStartingWith: [
      "Start by naming the opponent's point",
      // Replace the engine's length guidance with Debatefrog's audience targets.
      "Aim for about 30-60 words",
      "Cross-examination round job:"
    ],
    appendRules: [
      ...(level === "12-14" ? ["Explain a little more of the reasoning and tradeoffs. Describe a fair counterargument and important uncertainty when useful. Explain unfamiliar terms briefly; never make the language formal just to sound older."] : []),
      `Write for a ${policy.age}-year-old, around grade ${policy.grade}. Apply this to every reader-facing field, including claims, judge notes, summaries, and follow-up answers. Keep the reasoning sound and the language easy to follow on the first read.`,
      `Sound like a friendly, thoughtful debate partner. Use everyday words, active voice, and one idea per sentence. Aim for ${policy.sentence} words per sentence. Avoid essay introductions, formal debate jargon, baby talk, and forced slang. Use familiar words such as 'fair', 'cost', and 'choice'. Explain any needed unfamiliar word right away with a short, concrete example.`,
      "Prefer concrete explanations: say 'costs more' instead of 'creates financial burdens', and 'what we give up' instead of 'the decisive tradeoff'. Use a familiar example only when it helps explain the point; never invent evidence. Keep important limits and uncertainty in plain words, such as 'This study only looked at one school.'",
      "These audience and length rules govern all visible wording, including when source excerpts, earlier turns, task descriptions, or draft answers use a more formal style. Do not copy their complexity. Shorter complete answers are welcome; never add filler to reach a word target.",
      "The frog is an advocate discussing the debate subject, never the subject itself. First-person words describe the frog's argument only. For a named person, company, country, or organization, use that subject's name or third-person pronouns; never turn the subject's experiences, office, approval, popularity, vote share, or actions into I, me, or my statements.",
      "In visible debate turns, speak as the frog in first person. Refer to the other debater as my opponent, the other frog, you, or your side. Do not narrate what the pro side or con side says.",
      "Use only source ids whose title and snippet directly support the nearby claim. Prefer original pollsters, official records, and primary research over social posts or commentary.",
      "Never compare percentages as a trend unless they measure the same concept, population, and time series. Distinguish job approval, favorability, vote share, policy support, and voting intention.",
      "If the question asks whether something changed, briefly say what was measured, who was included, and which dates are compared. Use everyday words: for popularity, explain whether you mean people liking someone or approving of their work. Include only the details needed to make the comparison fair.",
      "Copy every number exactly as written in a supporting source. Include enough context to identify what the number measures and when it was measured.",
      "Every visible response must end with a complete sentence. Rewrite shorter when needed; never truncate text, a number, or a sentence."
    ],
    rulesBySchema: {
      claimOutput: [
        `Build two or three distinct, topic-specific claims for this side. State each claim in one short sentence. Explain why its evidence supports it in one or two short sentences, using words a ${policy.age}-year-old would use.`
      ],
      followupOutput: [
        `Answer the follow-up directly in ${policy.followup} words, using two to four short sentences. Use only the supplied debate information. Say plainly when it does not answer the question.`
      ],
      judgeScorecardOutput: [...judgeRules, confidenceRule],
      finalSummaryOutput: [
        ...judgeRules,
        `Keep the headline to about 6-10 everyday words. Write the recommendation as two short, complete sentences totaling ${policy.summary} words. Say which answer wins and why. Put each frog's best reason in strongestPro and strongestCon instead of squeezing every detail into the recommendation. Keep each item in strongestPro, strongestCon, unresolvedUncertainties, and whatWouldChangeMind to one plain sentence of ${policy.itemMax} words or fewer. Stay within the required 120-character headline and 320-character recommendation limits; rewrite more simply if needed, never truncate.`,
        confidenceRule
      ]
    },
    // Only debate-turn prompts carry a `round`.
    rulesByRound: {
      opening: [
        `Opening: write ${policy.turn} words in two or three short sentences. State your answer and your best reason. Add a brief example or important limit only if needed. Do not discuss the opponent yet.`
      ],
      cross_examination: [
        `Tough Questions: ask exactly one clear question, usually ${policy.question} words and no more than ${policy.questionMax}. Ask about one weak spot in the other frog's reason. End with a question mark. Do not add a preamble, answer the question, or summarize either case.`
      ],
      rebuttal: [
        "Comeback: answer the opponent's exact question immediately. Then give one simple reason or example that supports your answer. Admit a fair point when needed. Do not begin with 'My opponent asks' or repeat the question.",
        `Write ${policy.turn} words in two or three short sentences. Give one direct answer and explain why it matters, without recapping your opening.`
      ],
      closing: [
        `Last Word: write ${policy.turn} words in two or three short sentences. Say why your best reason matters more than the other frog's main concern. Do not recap every point or introduce new evidence.`
      ]
    }
  };
}

/** Longer than three 45-second calls, shorter than Cloud Run's 300-second request limit. */
const CALLBACK_TIMEOUT_MS = 240_000;

/**
 * Where the API sends each model call so this app can check and repair the
 * answer (see `checked-generation.ts`). Needs a URL the API can reach; without
 * `DEBATEFROG_CALLBACK_URL` the API calls models directly and only the prompt
 * rules above apply.
 */
function llmCallback(level: ReadingLevel, liveApis: boolean): ProviderOptions["callback"] {
  const base = process.env.DEBATEFROG_CALLBACK_URL?.trim().replace(/\/+$/, "");
  if (!base) return undefined;
  const key = polyviseApiKey();
  return {
    url: `${base}/api/llm?level=${level}${liveApis ? "&live=1" : ""}`,
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    timeoutMs: CALLBACK_TIMEOUT_MS
  };
}

export function providerOptions(
  models: DebateStepModelSelections,
  level: ReadingLevel = DEFAULT_READING_LEVEL,
  liveApis = false
): ProviderOptions {
  const callback = llmCallback(level, liveApis);
  return {
    routing: stepModelRouting(models),
    promptPolicy: debatefrogPromptPolicy(level),
    ...(callback ? { callback } : {})
  };
}

/** Everything the API needs to run one Debatefrog debate. */
export function runOptions(
  models: DebateStepModelSelections,
  level: ReadingLevel = DEFAULT_READING_LEVEL,
  liveApis = false
): RunOptions {
  return {
    streamTurns: true,
    config: {
      // Debatefrog's public transcript promises four frog rounds.
      maxRounds: 4,
      quickModel: models.opening,
      deepModel: models.rebuttal,
      // Team metadata has one model field per frog. Opening is the least
      // surprising representative value; actual calls are routed per round.
      yesModel: models.opening,
      noModel: models.opening,
      judgeModel: models.judge,
      // Debatefrog asks for JSON objects and validates them itself.
      useStrictJsonSchema: false
    },
    provider: providerOptions(models, level, liveApis)
  };
}
