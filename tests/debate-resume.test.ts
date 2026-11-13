import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DebateRecord } from "@polyvise/core/debate/types";
import type { LlmRequest } from "@polyvise/core/providers/llm";

const control = vi.hoisted(() => ({ failRole: "final summary", levels: [] as unknown[], calls: [] as string[], records: new Map<string, DebateRecord>() }));
vi.mock("@/server/repository", async (original) => {
  const module = await original<typeof import("@/server/repository")>();
  return { ...module, createDefaultDebateRepository: () => new module.MemoryDebateRepository({ debates: control.records, feedback: new Map() }) };
});
vi.mock("@/server/round-model-provider", async () => {
  const { MockLlmProvider } = await import("@polyvise/core/providers/llm");
  return { RoundModelLlmProvider: class extends MockLlmProvider {
    constructor(_config: unknown, _models: unknown, level: unknown) { super(); control.levels.push(level); }
    async generateStructured<T>(request: LlmRequest) {
      control.calls.push(request.role);
      if (request.role === control.failRole) throw new Error("Model timed out");
      return super.generateStructured<T>(request);
    }
  } };
});
import { addFollowup, getDebate, retryDebate, startDebate, subscribeToDebate } from "@/server/debate-store";

beforeEach(() => {
  control.records.clear();
  control.levels.length = 0;
  control.calls.length = 0;
  control.failRole = "final summary";
  vi.stubEnv("POLYVISE_EVIDENCE_PROVIDER", "mock");
  vi.stubEnv("POLYVISE_ALLOW_DETERMINISTIC_FALLBACKS", "false");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function failedDebate() {
  const result = await startDebate({ subject: "Should homework be banned?", mode: "hybrid_council", evidence: "cited", councilSize: "duo" });
  await expect(result.completion).rejects.toThrow("Model timed out");
  return (await getDebate(result.debate.id))!;
}

function waitForTerminal(id: string) {
  return new Promise<void>((resolve) => {
    subscribeToDebate(id, (event) => { if (event.kind === "complete" || event.kind === "error") resolve(); });
  });
}

describe("saved stage retry", () => {
  it("keeps the finished rounds, resumes only the judge, and publishes completion after saving", async () => {
    const failed = await failedDebate();
    expect(failed.status).toBe("failed");
    expect(failed.recovery).toEqual({ available: true, attempt: 0 });
    expect(failed).not.toHaveProperty("retryState");
    const turns = failed.liveEvents!.flatMap((event) => event.kind === "turns" ? event.turns : []);
    expect(turns).toHaveLength(9);
    control.failRole = "";
    control.calls.length = 0;
    const resumed = await retryDebate(failed.id, 0);
    expect(resumed?.accepted).toBe(true);
    await waitForTerminal(failed.id);
    const complete = (await getDebate(failed.id))!;
    expect(complete.status).toBe("complete");
    expect(control.calls).toEqual(["final summary"]);
    expect(complete.latestRun?.turns).toEqual(turns);
    expect(complete.recovery?.attempt).toBe(1);
  });

  it("allows only one worker for simultaneous retry clicks", async () => {
    const failed = await failedDebate();
    control.failRole = "";
    control.calls.length = 0;
    const responses = await Promise.all([retryDebate(failed.id, 0), retryDebate(failed.id, 0)]);
    await waitForTerminal(failed.id);
    expect(responses.every((result) => result?.debate.recovery?.attempt === 1)).toBe(true);
    expect(control.calls).toEqual(["final summary"]);
  });

  it("never replays a previous attempt's failure into a resumed stream", async () => {
    const failed = await failedDebate();
    const listener = vi.fn();
    const subscription = subscribeToDebate(failed.id, listener, 1);
    expect(subscription.terminal).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not let a repeated old request start a second failed attempt", async () => {
    const failed = await failedDebate();
    await retryDebate(failed.id, 0);
    await waitForTerminal(failed.id);
    control.calls.length = 0;
    expect((await retryDebate(failed.id, 0))?.accepted).toBe(false);
    expect(control.calls).toEqual([]);
    expect((await getDebate(failed.id))?.recovery?.attempt).toBe(1);
  });

  it("handles failures before any visible rounds", async () => {
    control.failRole = "con advocate claim builder";
    const failed = await failedDebate();
    expect(failed.liveEvents?.some((event) => event.kind === "turns")).toBe(false);
    control.failRole = "";
    control.calls.length = 0;
    await retryDebate(failed.id, 0);
    await waitForTerminal(failed.id);
    expect(control.calls[0]).toBe("con advocate claim builder");
    expect(control.calls).not.toContain("pro advocate claim builder");
    expect((await getDebate(failed.id))?.status).toBe("complete");
  });

  it("recovers an abandoned worker from durable progress after the idle deadline", async () => {
    const failed = await failedDebate();
    const saved = control.records.get(failed.id)!;
    control.records.set(failed.id, { ...saved, status: "judging", updatedAt: new Date(Date.now() - 6 * 60_000).toISOString() });
    control.failRole = "";
    control.calls.length = 0;
    expect((await retryDebate(failed.id, 0))?.accepted).toBe(true);
    await waitForTerminal(failed.id);
    expect(control.calls).toEqual(["final summary"]);
    expect((await getDebate(failed.id))?.status).toBe("complete");
  });

  it("does not rerun completed debates or pretend legacy records have checkpoints", async () => {
    const failed = await failedDebate();
    control.records.set(failed.id, { ...failed, status: "failed" });
    expect((await retryDebate(failed.id, 0))?.accepted).toBe(false);
    expect((await getDebate(failed.id))?.recovery?.available).toBe(false);
    expect(await retryDebate("missing", 0)).toBeNull();
  });
});

 it("preserves the selected reading level through retries and follow-up saves", async () => {
   const started = await startDebate({ subject: "Should schools have longer recess?", readingLevel: "12-14" });
   await expect(started.completion).rejects.toThrow();
   control.failRole = "";
   await retryDebate(started.debate.id, 0);
   await waitForTerminal(started.debate.id);
   await addFollowup(started.debate.id, "What matters most?");
   expect(control.levels).toEqual(["12-14", "12-14", "12-14"]);
   const saved = control.records.get(started.debate.id);
   expect(saved).toHaveProperty("readingLevel", "12-14");
   expect(saved).toHaveProperty("retryState");
   expect((await getDebate(started.debate.id))?.readingLevel).toBe("12-14");
 });
