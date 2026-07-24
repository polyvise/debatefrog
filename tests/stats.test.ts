import { describe, expect, it } from "vitest";
import type { DebateRecord, UserFeedback } from "@polyvise/core/debate/types";
import { summarizePublicStats } from "@/server/stats";

function debate(
  id: string,
  status: DebateRecord["status"],
  createdAt: string,
  model = "moonshotai/kimi-k3"
): DebateRecord {
  return {
    id,
    subject: `private subject ${id}`,
    mode: "hybrid_council",
    evidence: "cited",
    status,
    resolution: "private resolution",
    topicKind: "decision",
    highStakes: null,
    createdAt,
    updatedAt: createdAt,
    productNotes: [],
    followups: id === "one" ? [{ id: "f1", question: "private", answer: "private", createdAt }] : [],
    latestRun: {
      id: `run-${id}`,
      debateId: id,
      status,
      startedAt: createdAt,
      events: [],
      scouts: [],
      teams: { pro: [], con: [], judge: { id: "j", name: "Judge", model, role: "judge" } },
      sources: [{ id: "s", title: "", url: "", publisher: "", snippet: "", quality: "context", retrievedVia: "mock", status: "accepted" }],
      claims: [],
      argumentNodes: [],
      argumentEdges: [],
      turns: [{ id: "t", round: "opening", agentId: "a", agentName: "A", side: "pro", content: "", claimIds: [], sourceIds: [], createdAt }],
      scorecard: { recommendation: "mixed", confidence: 0.5, categories: [] },
      summary: { headline: "", recommendation: "", strongestPro: [], strongestCon: [], unresolvedUncertainties: [], whatWouldChangeMind: [], confidence: 0.5 },
      modelSnapshots: [{ id: "m", provider: "openrouter", model, role: "debater", configured: true, promptTokens: 100, completionTokens: 25, estimatedCostUsd: 0.01 }],
      artifactManifest: [],
      trace: []
    }
  };
}

describe("public stats", () => {
  it("returns aggregate activity without carrying user content", () => {
    const feedback = [{ id: "feedback", app: "test", message: "private feedback", metadata: {}, createdAt: "2026-07-23T12:00:00Z" }] as UserFeedback[];
    const stats = summarizePublicStats(
      [
        debate("one", "complete", "2026-07-23T12:00:00Z"),
        debate("two", "failed", "2026-06-01T12:00:00Z"),
        debate("three", "debating", "2026-07-24T12:00:00Z", "openai/gpt-5.5")
      ],
      feedback,
      new Date("2026-07-24T18:00:00Z")
    );

    expect(stats.totalDebates).toBe(3);
    expect(stats.completedDebates).toBe(1);
    expect(stats.completionRate).toBeCloseTo(1 / 3);
    expect(stats.activeDebates).toBe(1);
    expect(stats.recent7Days).toBe(2);
    expect(stats.totalSources).toBe(3);
    expect(stats.totalTurns).toBe(3);
    expect(stats.totalFollowups).toBe(1);
    expect(stats.feedbackCount).toBe(1);
    expect(stats.promptTokens).toBe(300);
    expect(stats.modelUsage[0]).toEqual({ model: "moonshotai/kimi-k3", debates: 2 });
    expect(JSON.stringify(stats)).not.toContain("private");
  });
});
