import { describe, expect, it } from "vitest";
import {
  resolveDebateStepModelDefaults,
  resolveDebateStepModels
} from "@/lib/debate-step-models";
import {
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

  it("maps both frog roles to a round rather than a side", () => {
    expect(stepForRole("yes frog opening round")).toBe("opening");
    expect(stepForRole("no frog opening round")).toBe("opening");
    expect(stepForRole("yes frog cross-examination round")).toBe("crossExamination");
    expect(stepForRole("no frog rebuttal round")).toBe("rebuttal");
    expect(stepForRole("yes frog closing round")).toBe("closing");
    expect(stepForRole("final summary")).toBe("judge");
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
      role: "yes frog rebuttal round",
      schemaName: "debateTurnOutput",
      prompt: JSON.stringify(basePrompt)
    });
    const parsed = JSON.parse(prepared.prompt) as { rules: string[] };

    expect(parsed.rules.some((rule) => rule.startsWith("Start by naming"))).toBe(false);
    expect(parsed.rules.some((rule) => rule.includes("answer the opponent's exact question immediately"))).toBe(true);
    expect(parsed.rules.some((rule) => rule.includes("never the subject itself"))).toBe(true);
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

    expect(issues.join(" ")).toContain("more detail");
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
              "Vote share and job approval measure different things, so what comparable polling series shows that the change you describe is still happening now?",
            sourceIds: ["source-1"]
          }
        ]
      },
      JSON.stringify({ round: "cross_examination", sources: [{ id: "source-1" }] })
    );

    expect(issues).toEqual([]);
  });
});
