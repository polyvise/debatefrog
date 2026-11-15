import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveDebateStepModelDefaults,
  resolveDebateStepModels
} from "@/lib/debate-step-models";
import type { ReadingLevel } from "@/lib/reading-level";
import { debatefrogPromptPolicy, runOptions, stepModelRouting } from "@/server/generation-policy";
import { semanticOutputIssues } from "@/server/checked-generation";

afterEach(() => vi.unstubAllEnvs());

/** The rules the API adds to one prompt: every call's, then its schema's, then its round's. */
function addedRules(schemaName: string, round?: string, level?: ReadingLevel): string {
  const policy = debatefrogPromptPolicy(level);
  return [
    ...policy.appendRules,
    ...(policy.rulesBySchema[schemaName] ?? []),
    ...(round ? policy.rulesByRound[round] ?? [] : [])
  ].join("\n");
}

/** The model the API's routing picks for a role: first matching rule, else the default. */
function routedModel(role: string): string | undefined {
  const routing = stepModelRouting({
    opening: "opening", crossExamination: "crossExamination", rebuttal: "rebuttal", closing: "closing", judge: "judge"
  });
  return routing.rules.find((rule) => rule.contains.some((term) => role.toLowerCase().includes(term)))?.model
    ?? routing.defaultModel;
}

describe("mirrored per-step model routing", () => {
  it("uses economical early-round defaults and stronger later-round defaults", () => {
    expect(resolveDebateStepModelDefaults({})).toEqual({
      opening: "openai/gpt-4o-mini",
      crossExamination: "openai/gpt-4o-mini",
      rebuttal: "openai/gpt-4.1",
      closing: "openai/gpt-4.1",
      judge: "openai/gpt-4.1"
    });
  });

  it("accepts one shared model selection for each round", () => {
    const defaults = resolveDebateStepModelDefaults({});
    expect(resolveDebateStepModels({ rebuttal: "google/gemini-3.1-flash-lite" }, defaults)).toEqual({
      ...defaults,
      rebuttal: "google/gemini-3.1-flash-lite"
    });
  });

  it("maps both advocate roles to a round rather than a side", () => {
    expect(routedModel("pro advocate opening round")).toBe("opening");
    expect(routedModel("con advocate opening round")).toBe("opening");
    expect(routedModel("pro advocate claim builder")).toBe("opening");
    expect(routedModel("pro advocate cross-examination round")).toBe("crossExamination");
    expect(routedModel("con advocate rebuttal round")).toBe("rebuttal");
    expect(routedModel("pro advocate closing round")).toBe("closing");
    expect(routedModel("judge review round")).toBe("judge");
    expect(routedModel("scorecard judge")).toBe("judge");
    expect(routedModel("final summary")).toBe("judge");
  });
});

describe("run options sent to the Polyvise API", () => {
  const models = resolveDebateStepModelDefaults({});

  it("asks for four streamed rounds in JSON-object mode with per-round models", () => {
    const options = runOptions({ ...models, opening: "a/opening", judge: "a/judge" });
    expect(options.streamTurns).toBe(true);
    expect(options.config).toMatchObject({
      maxRounds: 4, useStrictJsonSchema: false,
      quickModel: "a/opening", yesModel: "a/opening", noModel: "a/opening",
      deepModel: models.rebuttal, judgeModel: "a/judge"
    });
    expect(options.provider?.routing?.defaultModel).toBe("a/opening");
  });

  it("calls models directly unless the API can reach this app", () => {
    expect(runOptions(models).provider?.callback).toBeUndefined();
  });

  it("routes model calls back through this app's checks when a callback URL is set", () => {
    vi.stubEnv("DEBATEFROG_CALLBACK_URL", "https://debatefrog.test/");
    vi.stubEnv("POLYVISE_API_KEY", "secret-key");
    expect(runOptions(models, "12-14", true).provider?.callback).toMatchObject({
      url: "https://debatefrog.test/api/llm?level=12-14&live=1",
      headers: { Authorization: "Bearer secret-key" }
    });
    expect(runOptions(models).provider?.callback?.url).toBe("https://debatefrog.test/api/llm?level=9-11");
  });
});

describe("Debatefrog generation guardrails", () => {
  it("removes the repetition-inducing instruction and adds direct-answer guidance", () => {
    const policy = debatefrogPromptPolicy();
    expect("Start by naming the opponent's point in plain speech".startsWith(policy.removeRulesStartingWith[0])).toBe(true);
    const rules = addedRules("debateTurnOutput", "rebuttal");
    expect(rules).toContain("answer the opponent's exact question immediately");
    expect(rules).toContain("never the subject itself");
    expect(rules).toContain("10-year-old");
    expect(rules).toContain("speak as the frog");
  });

  it("replaces inherited length rules without dropping evidence or question requirements", () => {
    const { removeRulesStartingWith } = debatefrogPromptPolicy();
    const inherited = [
      "Aim for about 30-60 words in each turn's content.",
      "Cross-examination round job: ask exactly one short, pointed question, usually 15-35 words.",
      "Only cite relevant sources."
    ];
    expect(inherited.filter((rule) => !removeRulesStartingWith.some((prefix) => rule.startsWith(prefix))))
      .toEqual(["Only cite relevant sources."]);
    const rules = addedRules("debateTurnOutput", "cross_examination");
    expect(rules).toContain("8-15 words");
    expect(rules).toContain("End with a question mark");
  });

  it("keeps brevity a prompt target rather than forcing short complete answers to expand", () => {
    for (const round of ["opening", "rebuttal", "closing"]) {
      expect(addedRules("debateTurnOutput", round)).toContain("20-35 words");
      expect(semanticOutputIssues("debateTurnOutput", {
        turns: [{ round, content: "I support longer recess because students need a chance to rest and return to class ready to learn.", sourceIds: [] }]
      }, JSON.stringify({ round, sources: [] }))).toEqual([]);
    }
  });

  it.each(["claimOutput", "judgeScorecardOutput", "finalSummaryOutput", "followupOutput"])(
    "applies the same audience to %s", (schemaName) => {
      const rules = addedRules(schemaName);
      expect(rules).toContain("10-year-old");
      expect(rules).toContain("grade 4");
      expect(rules).toContain("6-12 words per sentence");
      expect(rules).toContain("everyday words");
      expect(rules).toContain("never invent evidence");
    }
  );

  it("gives the judge frog names and the summary its limits", () => {
    expect(addedRules("judgeScorecardOutput")).toContain("green frog");
    expect(addedRules("judgeScorecardOutput")).not.toContain("320-character");
    expect(addedRules("finalSummaryOutput")).toContain("320-character");
    expect(addedRules("finalSummaryOutput")).toContain("Calibrate confidence");
  });

  it.each(["claimOutput", "debateTurnOutput", "judgeScorecardOutput", "finalSummaryOutput", "followupOutput"])(
    "uses the older audience for %s", (schemaName) => {
      const rules = addedRules(schemaName, "opening", "12-14");
      expect(rules).toContain("13-year-old");
      expect(rules).toContain("grade 7");
      expect(rules).toContain("tradeoffs");
      expect(rules).not.toContain("10-year-old");
      expect(rules).not.toContain("${policy");
      if (schemaName === "followupOutput") expect(rules).toContain("30-60 words");
    }
  );

  it("rejects truncated, non-question, persona-confused, and unknown-source turns", () => {
    const prompt = JSON.stringify({
      round: "cross_examination",
      sources: [{ id: "source-1" }]
    });
    const issues = semanticOutputIssues(
      "debateTurnOutput",
      {
        turns: [
          {
            round: "cross_examination",
            content: "My approval fell from 49.8 percent to 36 percent according to",
            sourceIds: ["made-up-source"]
          }
        ]
      },
      prompt
    );

    expect(issues.join(" ")).toContain("complete sentence");
    expect(issues.join(" ")).toContain("exactly one question");
    expect(issues.join(" ")).toContain("named debate subject");
    expect(issues.join(" ")).toContain("unknown source id");
  });

  it("accepts a complete, sourced, pointed question", () => {
    const issues = semanticOutputIssues(
      "debateTurnOutput",
      {
        turns: [
          {
            round: "cross_examination",
            content:
              "Winning votes and doing a good job are different, so which polls show more people approve of the job now?",
            sourceIds: ["source-1"]
          }
        ]
      },
      JSON.stringify({ round: "cross_examination", sources: [{ id: "source-1" }] })
    );

    expect(issues).toEqual([]);
  });

  it.each([
    ["84%", "84 percent"],
    ["84 percent", "84%"],
    ["84 %", "84 PER CENT"],
    ["49.8%", "49,8 percent"],
    ["84.0 percent", "84%"]
  ])("accepts equivalent percentage formats: %s and %s", (claim, evidence) => {
    expect(semanticOutputIssues("debateTurnOutput", {
      turns: [{ round: "opening", content: `I disagree because ${claim} of voters opposed the change.`, sourceIds: ["poll"] }]
    }, JSON.stringify({ sources: [{ id: "poll", snippet: `The poll found that ${evidence} of voters opposed the change.` }] }))).toEqual([]);
  });

  it.each(["184%", "0.84%", "84.5%", "84 people", "39 percent"])(
    "rejects percentage claims unsupported by the cited source: %s", (evidence) => {
      for (const claim of ["84%", "84 percent", "84 per cent"]) {
        const issues = semanticOutputIssues("debateTurnOutput", {
          turns: [{ round: "opening", content: `I disagree because ${claim} of voters opposed the change.`, sourceIds: ["poll"] }]
        }, JSON.stringify({ sources: [
          { id: "poll", snippet: evidence },
          { id: "uncited-poll", snippet: "84% of voters opposed the change." }
        ] }));
        expect(issues).toContain("Percentage 84% must appear in one of the turn's cited sources.");
      }
    }
  );

  it.each([
    ["opening", 35], ["rebuttal", 35], ["closing", 35], ["cross_examination", 20]
  ])("requests a rewrite above the %s word limit without imposing a minimum", (round, limit) => {
    const content = `${Array(Number(limit)).fill("word").join(" ")}${round === "cross_examination" ? "?" : "."}`;
    const prompt = JSON.stringify({ round });
    const output = (text: string) => ({ turns: [{ round, content: text, sourceIds: [] }] });
    expect(semanticOutputIssues("debateTurnOutput", output(content), prompt)).toEqual([]);
    expect(semanticOutputIssues("debateTurnOutput", output(`Another ${content}`), prompt))
      .toEqual([expect.stringContaining("Brevity:")]);
  });

  it("matches repair limits to the selected audience", () => {
    const output = { turns: [{ round: "opening", content: `${"word ".repeat(39)}done.`, sourceIds: [] }] };
    expect(semanticOutputIssues("debateTurnOutput", output, "{}", "9-11").join()).toContain("10-year-old");
    expect(semanticOutputIssues("debateTurnOutput", output, "{}", "12-14")).toEqual([]);
  });

  it("checks summary detail as well as the main verdict for wordiness", () => {
    const issues = semanticOutputIssues("finalSummaryOutput", {
      headline: "Longer recess wins",
      recommendation: `${"We can rest. ".repeat(12)}`,
      strongestPro: [`${"More time to play helps us rest. ".repeat(3)}`],
      strongestCon: ["Less class time could mean less time to learn."]
    }, "{}");
    expect(issues).toEqual([
      expect.stringContaining("Brevity: Recommendation"),
      expect.stringContaining("Brevity: strongestPro item")
    ]);
  });

  it("requires the final recommendation to fit the public summary contract", () => {
    const issues = semanticOutputIssues(
      "finalSummaryOutput",
      {
        headline: "A clear result",
        recommendation: `${"This explanation is too long. ".repeat(15)}`,
        strongestPro: [],
        strongestCon: [],
        unresolvedUncertainties: [],
        whatWouldChangeMind: []
      },
      "{}"
    );

    expect(issues.join(" ")).toContain("320 characters or fewer");
  });
});
