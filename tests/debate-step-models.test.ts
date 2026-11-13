import { afterEach, describe, expect, it, vi } from "vitest";
import { loadDebateRuntimeConfig } from "@polyvise/core/debate/config";
import { OpenRouterLlmProvider } from "@polyvise/core/providers/llm";
import {
  resolveDebateStepModelDefaults,
  resolveDebateStepModels
} from "@/lib/debate-step-models";
import {
  RoundModelLlmProvider,
  semanticOutputIssues,
  stepForRole,
  withDebatefrogGenerationRules
} from "@/server/round-model-provider";

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
    expect(stepForRole("pro advocate opening round")).toBe("opening");
    expect(stepForRole("con advocate opening round")).toBe("opening");
    expect(stepForRole("pro advocate cross-examination round")).toBe("crossExamination");
    expect(stepForRole("con advocate rebuttal round")).toBe("rebuttal");
    expect(stepForRole("pro advocate closing round")).toBe("closing");
    expect(stepForRole("final summary")).toBe("judge");
  });
});

describe("Debatefrog brevity repair", () => {
  afterEach(() => vi.restoreAllMocks());

  const request = {
    role: "pro advocate opening round",
    schemaName: "debateTurnOutput",
    prompt: JSON.stringify({ round: "opening", sources: [] })
  };
  const response = (content: string, sourceIds: string[] = []) => ({
    data: { turns: [{ round: "opening", content, sourceIds, agentId: "pro", agentName: "Yes Frog", side: "pro", claimIds: [] }] },
    snapshot: { id: "test", provider: "openrouter" as const, model: "test", role: request.role, configured: true }
  });
  const longAnswer = "More time outside helps us rest. ".repeat(8).trim();
  const provider = () => new RoundModelLlmProvider(
    { ...loadDebateRuntimeConfig(), enableMockLlm: false },
    resolveDebateStepModelDefaults({})
  );

  it("rewrites an overlong turn once and returns the shorter answer intact", async () => {
    const shortAnswer = "I support longer recess. Playing outside gives us a break so we can focus in class.";
    const generate = vi.spyOn(OpenRouterLlmProvider.prototype, "generateStructured")
      .mockResolvedValueOnce(response(longAnswer))
      .mockResolvedValueOnce(response(shortAnswer));

    const result = await provider().generateStructured(request);

    expect(generate).toHaveBeenCalledTimes(2);
    const repair = JSON.parse(generate.mock.calls[1][0].prompt);
    expect(repair.outputToRepair).toEqual(response(longAnswer).data);
    expect(repair.semanticRepairRequired).toEqual([expect.stringContaining("35 words or fewer")]);
    expect(result.data).toEqual(response(shortAnswer).data);
  });

  it("does not discard or truncate a complete debate if the rewrite is still wordy", async () => {
    const generate = vi.spyOn(OpenRouterLlmProvider.prototype, "generateStructured")
      .mockResolvedValue(response(longAnswer));
    const result = await provider().generateStructured(request);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.data).toEqual(response(longAnswer).data);
  });

  it("still rejects unsupported citations after the rewrite", async () => {
    vi.spyOn(OpenRouterLlmProvider.prototype, "generateStructured")
      .mockResolvedValue(response(longAnswer, ["made-up-source"]));
    await expect(provider().generateStructured(request)).rejects.toThrow("unknown source id");
  });

  it("gives the judge its rejected summary to shorten before completing", async () => {
    const summary = {
      headline: "Less homework wins",
      recommendation: "The green frog made a strong point about giving children more time to rest. ".repeat(5),
      strongestPro: ["Children need time to rest."], strongestCon: ["Practice helps children learn."],
      unresolvedUncertainties: [], whatWouldChangeMind: [], confidence: 0.7
    };
    const repaired = { ...summary, recommendation: "The green frog wins because rest matters. Practice helps too, but children need time to play after school." };
    const generate = vi.spyOn(OpenRouterLlmProvider.prototype, "generateStructured")
      .mockResolvedValueOnce({ ...response(""), data: summary })
      .mockResolvedValueOnce({ ...response(""), data: repaired });
    const result = await provider().generateStructured({
      ...request, role: "final summary", schemaName: "finalSummaryOutput"
    });
    expect(result.data).toEqual(repaired);
    const prompt = JSON.parse(generate.mock.calls[1][0].prompt);
    expect(prompt.outputToRepair).toEqual(summary);
    expect(prompt.semanticRepairRequired.join(" ")).toMatch(/recommendation/i);
    expect(prompt.semanticRepairRequired.join(" ")).toContain("320");
  });
});

describe("Debatefrog generation guardrails", () => {
  const basePrompt = {
    rules: [
      "Start by naming the opponent's point in plain speech, such as 'My opponent is right that...'",
      "Keep it clear."
    ],
    round: "rebuttal",
    sources: [{ id: "source-1", title: "A poll", snippet: "Approval was 40%." }]
  };

  it("removes the repetition-inducing instruction and adds direct-answer guidance", () => {
    const prepared = withDebatefrogGenerationRules({
      role: "pro advocate rebuttal round",
      schemaName: "debateTurnOutput",
      prompt: JSON.stringify(basePrompt)
    });
    const parsed = JSON.parse(prepared.prompt) as { rules: string[] };

    expect(parsed.rules.some((rule) => rule.startsWith("Start by naming"))).toBe(false);
    expect(parsed.rules.some((rule) => rule.includes("answer the opponent's exact question immediately"))).toBe(true);
    expect(parsed.rules.some((rule) => rule.includes("never the subject itself"))).toBe(true);
    expect(parsed.rules.some((rule) => rule.includes("10-year-old"))).toBe(true);
    expect(parsed.rules.some((rule) => rule.includes("speak as the frog"))).toBe(true);
  });

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

  it("keeps brevity a prompt target rather than forcing short complete answers to expand", () => {
    for (const round of ["opening", "rebuttal", "closing"]) {
      const prepared = withDebatefrogGenerationRules({
        role: "pro advocate", schemaName: "debateTurnOutput",
        prompt: JSON.stringify({ ...basePrompt, round })
      });
      expect(prepared.prompt).toContain("20-35 words");
      expect(prepared.prompt).not.toMatch(/45 to (80|85) words/);
      expect(semanticOutputIssues("debateTurnOutput", {
        turns: [{ round, content: "I support longer recess because students need a chance to rest and return to class ready to learn.", sourceIds: [] }]
      }, prepared.prompt)).toEqual([]);
    }
  });

  it("replaces inherited length rules without dropping evidence or question requirements", () => {
    const prepared = withDebatefrogGenerationRules({
      role: "pro advocate cross-examination round",
      schemaName: "debateTurnOutput",
      prompt: JSON.stringify({
        round: "cross_examination",
        rules: [
          "Aim for about 30-60 words in each turn's content.",
          "Cross-examination round job: ask exactly one short, pointed question, usually 15-35 words.",
          "Only cite relevant sources."
        ]
      })
    });
    expect(prepared.prompt).not.toMatch(/30-60|15-35/);
    expect(prepared.prompt).toContain("8-15 words");
    expect(prepared.prompt).toContain("End with a question mark");
    expect(prepared.prompt).toContain("Only cite relevant sources");
  });

  it.each(["claimOutput", "judgeScorecardOutput", "finalSummaryOutput", "followupOutput"])(
    "applies the same audience to %s", (schemaName) => {
      const prepared = withDebatefrogGenerationRules({
        role: "judge", schemaName, prompt: JSON.stringify({ rules: [] })
      });
      expect(prepared.prompt).toContain("10-year-old");
      expect(prepared.prompt).toContain("grade 4");
      expect(prepared.prompt).toContain("6-12 words per sentence");
      expect(prepared.prompt).toContain("everyday words");
      expect(prepared.prompt).toContain("never invent evidence");
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
