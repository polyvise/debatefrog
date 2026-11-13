import { describe, expect, it } from "vitest";
import { debateStatuses, type DebateRecord, type UserFeedback } from "@polyvise/core/debate/types";
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
    expect(stats.unfinishedDebates).toBe(1);
    expect(stats.recent7Days).toBe(2);
    expect(stats.totalSources).toBe(3);
    expect(stats.totalTurns).toBe(3);
    expect(stats.totalFollowups).toBe(1);
    expect(stats.feedbackCount).toBe(1);
    expect(stats.promptTokens).toBe(300);
    expect(stats.modelUsage[0]).toEqual({ model: "moonshotai/kimi-k3", debates: 2 });
    expect(JSON.stringify(stats)).not.toContain("private");
  });

  it("reconciles every saved outcome, including old unfinished and partial debates", () => {
    const records = debateStatuses.map((status) => debate(status, status, "2026-05-21T00:00:00Z"));
    const stats = summarizePublicStats(records, [], new Date("2026-11-13T22:00:00Z"));
    expect(stats.totalDebates).toBe(8);
    expect(stats.completedDebates).toBe(1);
    expect(stats.completionRate).toBe(1 / 8);
    expect(stats.unfinishedDebates).toBe(5);
    expect(stats.statusBreakdown.every((item) => item.count === 1)).toBe(true);
    expect(stats.statusBreakdown.reduce((sum, item) => sum + item.count, 0)).toBe(stats.totalDebates);
    expect(stats).not.toHaveProperty("activeDebates");
  });

  it("counts a retried debate by its latest result rather than counting past failures again", () => {
    const record = debate("retry", "failed", "2026-11-13T10:00:00Z");
    const failed = summarizePublicStats([record], []);
    expect(failed.statusBreakdown.find((item) => item.status === "failed")?.count).toBe(1);
    record.status = "complete";
    record.latestRun!.status = "complete";
    const recovered = summarizePublicStats([record], []);
    expect(recovered.totalDebates).toBe(1);
    expect(recovered.completedDebates).toBe(1);
    expect(recovered.statusBreakdown.find((item) => item.status === "failed")?.count).toBe(0);
  });

  it("uses inclusive UTC day boundaries, excludes future dates, and keeps 14 daily buckets", () => {
    const dates = [
      "2026-11-07T00:00:00Z", "2026-11-06T23:59:59Z",
      "2026-10-15T00:00:00Z", "2026-10-14T23:59:59Z",
      "2026-11-13T12:00:00Z", "2026-11-13T12:00:01Z",
      "2026-11-14T00:00:00Z", "invalid"
    ];
    const stats = summarizePublicStats(dates.map((date, i) => debate(`${i}`, "complete", date)), [], new Date("2026-11-13T12:00:00Z"));
    expect(stats.recent7Days).toBe(2);
    expect(stats.recent30Days).toBe(4);
    expect(stats.dailyActivity).toHaveLength(14);
    expect(stats.dailyActivity[0].date).toBe("2026-10-31");
    expect(stats.dailyActivity[13]).toMatchObject({ date: "2026-11-13", count: 1 });
    expect(stats.dailyActivity.reduce((sum, day) => sum + day.count, 0)).toBe(3);
  });

  it("counts each model once per debate while summing all saved call tokens", () => {
    const record = debate("one", "complete", "2026-11-13T00:00:00Z");
    const snapshot = record.latestRun!.modelSnapshots[0];
    record.latestRun!.modelSnapshots.push({ ...snapshot, id: "second-call" });
    const stats = summarizePublicStats([record], []);
    expect(stats.modelUsage).toEqual([{ model: snapshot.model, debates: 1 }]);
    expect(stats.promptTokens).toBe(200);
    expect(stats.completionTokens).toBe(50);
  });

  it("handles no records and counts more than the recent-history limit", () => {
    const empty = summarizePublicStats([], []);
    expect(empty.totalDebates).toBe(0);
    expect(empty.completionRate).toBe(0);
    expect(empty.unfinishedDebates).toBe(0);
    expect(empty.statusBreakdown.every((item) => item.count === 0)).toBe(true);
    const records = Array.from({ length: 125 }, (_, i) => debate(`${i}`, i % 2 ? "failed" : "complete", "2026-11-13T00:00:00Z"));
    const stats = summarizePublicStats(records, []);
    expect(stats.totalDebates).toBe(125);
    expect(stats.completedDebates).toBe(63);
    expect(stats.statusBreakdown.find((item) => item.status === "failed")?.count).toBe(62);
  });
});
