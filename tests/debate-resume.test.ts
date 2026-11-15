import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DebateLiveEvent, DebateRecord } from "@/lib/polyvise-api/types";
import { fixtures, installFakeApi, type FakeApi } from "./helpers/fake-api";

const control = vi.hoisted(() => ({ records: new Map<string, DebateRecord>() }));
vi.mock("@/server/repository", async (original) => {
  const module = await original<typeof import("@/server/repository")>();
  return { ...module, createDefaultDebateRepository: () => new module.MemoryDebateRepository({ debates: control.records, feedback: new Map() }) };
});
import { POST as startRoute } from "@/app/api/debates/route";
import { addFollowup, getDebate, retryDebate, startDebate, subscribeToDebate } from "@/server/debate-store";

let api: FakeApi;
beforeEach(() => {
  control.records.clear();
  api = installFakeApi();
  api.failBefore = "summary";
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const homework = { subject: "Should homework be banned?", mode: "hybrid_council", evidence: "cited", councilSize: "duo" } as const;

async function failedDebate() {
  const result = await startDebate(homework);
  await expect(result.completion).rejects.toThrow("Model timed out");
  return (await getDebate(result.debate.id))!;
}

async function waitForTerminal(id: string, attempt?: number) {
  const events: DebateLiveEvent[] = [];
  await new Promise<void>((resolve) => {
    void subscribeToDebate(id, (event) => {
      events.push(event);
      if (event.kind === "complete" || event.kind === "error") resolve();
    }, attempt).then((subscription) => { if (subscription.terminal) resolve(); });
  });
  return events;
}

const resumes = (id: string) => api.posts(`/v1/jobs/${id}/resume`);

describe("starting a debate on the Polyvise API", () => {
  it("runs the engine as an API job and stores the finished debate before announcing it", async () => {
    api.failBefore = null;
    const started = await startDebate({ ...homework, models: { judge: "a/judge" } });
    expect(started.debate.status).toBe("queued");
    const events = await waitForTerminal(started.debate.id);
    expect(events.slice(-2)).toEqual([{ kind: "stage", status: "complete" }, { kind: "complete", runId: fixtures.job.run.id }]);
    expect(events.filter((event) => event.kind === "complete")).toHaveLength(1);
    const saved = (await started.completion) as DebateRecord;
    expect(saved.status).toBe("complete");
    expect(saved.latestRun?.turns).toHaveLength(9);
    expect(saved).not.toHaveProperty("liveEvents");

    const [job] = api.posts("/v1/jobs");
    expect(job.body.debateId).toBe(started.debate.id);
    expect(job.body.request).toMatchObject(homework);
    expect(job.body.options).toMatchObject({
      streamTurns: true,
      config: { maxRounds: 4, judgeModel: "a/judge" },
      provider: { routing: { defaultModel: "openai/gpt-4o-mini" } }
    });
    expect(JSON.stringify(job.body.options.provider.promptPolicy)).toContain("10-year-old");
  });

  it("leaves shared validation to the API and reports it as a bad request", async () => {
    const response = await startRoute(new Request("https://debatefrog.test/api/debates", {
      method: "POST", body: JSON.stringify({ subject: "No" })
    }) as never);
    expect(response.status).toBe(400);
    expect((await response.json()).issues[0].path).toEqual(["subject"]);
    expect(api.posts("/v1/jobs")).toHaveLength(0);
    expect(control.records.size).toBe(0);
  });

  it("picks up a debate another instance started and stores its outcome", async () => {
    api.failBefore = null;
    const started = await startDebate(homework);
    await started.completion;
    // Another instance holds the same queued record but never followed the job.
    const id = "debate_elsewhere";
    const saved = control.records.get(started.debate.id)!;
    control.records.set(id, { ...saved, id, status: "debating", latestRun: undefined });
    api.addJob(id);
    const events = await waitForTerminal(id, 0);
    expect(events.at(-1)?.kind).toBe("complete");
    expect((await getDebate(id))?.status).toBe("complete");
  });
});

describe("saved stage retry", () => {
  it("keeps the finished rounds, resumes the API's job, and publishes completion after saving", async () => {
    const failed = await failedDebate();
    expect(failed.status).toBe("failed");
    expect(failed.recovery).toEqual({ available: true, attempt: 0 });
    expect(failed).not.toHaveProperty("retryState");
    expect(control.records.get(failed.id)).toHaveProperty("retryState.checkpoint.completed");
    const turns = failed.liveEvents!.flatMap((event) => event.kind === "turns" ? event.turns : []);
    expect(turns).toHaveLength(9);
    expect((await waitForTerminal(failed.id, 0)).at(-1))
      .toEqual({ kind: "error", message: "The judge frog couldn't finish this step. You can try it again." });
    api.failBefore = null;
    const resumed = await retryDebate(failed.id, 0);
    expect(resumed?.accepted).toBe(true);
    await waitForTerminal(failed.id);
    const complete = (await getDebate(failed.id))!;
    expect(complete.status).toBe("complete");
    expect(resumes(failed.id).map((call) => call.body)).toEqual([{ attempt: 0 }]);
    expect(api.posts("/v1/jobs")).toHaveLength(1);
    expect(complete.latestRun?.turns).toEqual(turns);
    expect(complete.recovery?.attempt).toBe(1);
  });

  it("allows only one worker for simultaneous retry clicks", async () => {
    const failed = await failedDebate();
    api.failBefore = null;
    const responses = await Promise.all([retryDebate(failed.id, 0), retryDebate(failed.id, 0)]);
    await waitForTerminal(failed.id);
    expect(responses.every((result) => result?.debate.recovery?.attempt === 1)).toBe(true);
    expect(resumes(failed.id)).toHaveLength(1);
  });

  it("never replays a previous attempt's failure into a resumed stream", async () => {
    const failed = await failedDebate();
    const listener = vi.fn();
    const subscription = await subscribeToDebate(failed.id, listener, 1);
    expect(subscription.terminal).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not let a repeated old request start a second failed attempt", async () => {
    const failed = await failedDebate();
    await retryDebate(failed.id, 0);
    await waitForTerminal(failed.id);
    expect((await retryDebate(failed.id, 0))?.accepted).toBe(false);
    expect(resumes(failed.id)).toHaveLength(1);
    expect((await getDebate(failed.id))?.recovery?.attempt).toBe(1);
  });

  it("handles failures before any visible rounds", async () => {
    api.failBefore = "claims";
    const failed = await failedDebate();
    expect(failed.liveEvents?.some((event) => event.kind === "turns")).toBe(false);
    expect((await waitForTerminal(failed.id, 0)).at(-1))
      .toEqual({ kind: "error", message: "The frogs couldn't finish this step. You can try it again." });
    api.failBefore = null;
    await retryDebate(failed.id, 0);
    await waitForTerminal(failed.id);
    expect((await getDebate(failed.id))?.status).toBe("complete");
  });

  it("recovers an abandoned worker from durable progress after the idle deadline", async () => {
    const failed = await failedDebate();
    const saved = control.records.get(failed.id)!;
    control.records.set(failed.id, { ...saved, status: "judging", updatedAt: new Date(Date.now() - 6 * 60_000).toISOString() });
    api.failBefore = null;
    expect((await retryDebate(failed.id, 0))?.accepted).toBe(true);
    await waitForTerminal(failed.id);
    expect((await getDebate(failed.id))?.status).toBe("complete");
  });

  it("restarts from its own saved checkpoint when the API no longer has the job", async () => {
    const failed = await failedDebate();
    api.loseJobs();
    api.failBefore = null;
    expect((await retryDebate(failed.id, 0))?.accepted).toBe(true);
    await waitForTerminal(failed.id);
    expect(resumes(failed.id)).toHaveLength(0);
    const restart = api.posts("/v1/jobs")[1].body;
    expect(restart.debateId).toBe(failed.id);
    expect(restart.options.checkpoint.debateId).toBe(failed.id);
    expect(restart.options.checkpoint.completed).toEqual(fixtures.checkpoint.completed);
    expect((await getDebate(failed.id))?.status).toBe("complete");
  });

  it("marks a debate failed, and retryable, when the API loses the job mid-run", async () => {
    api.failBefore = null;
    const started = await startDebate(homework);
    await started.completion;
    const id = "debate_lost";
    control.records.set(id, { ...control.records.get(started.debate.id)!, id, status: "debating", latestRun: undefined });
    const events = await waitForTerminal(id, 0);
    expect(events.at(-1)?.kind).toBe("error");
    expect(await getDebate(id)).toMatchObject({ status: "failed", recovery: { available: true, attempt: 0 } });
  });

  it("gives the attempt back when the API cannot be reached for a retry", async () => {
    const failed = await failedDebate();
    api.routes[`/v1/jobs/${failed.id}`] = () => Response.json({ error: "Unavailable" }, { status: 503 });
    await expect(retryDebate(failed.id, 0)).rejects.toThrow("Unavailable");
    expect(await getDebate(failed.id)).toMatchObject({ status: "failed", recovery: { attempt: 0 } });
    delete api.routes[`/v1/jobs/${failed.id}`];
    api.failBefore = null;
    expect((await retryDebate(failed.id, 0))?.accepted).toBe(true);
  });

  it("does not rerun completed debates or pretend legacy records have checkpoints", async () => {
    const failed = await failedDebate();
    control.records.set(failed.id, { ...failed, status: "failed" });
    expect((await retryDebate(failed.id, 0))?.accepted).toBe(false);
    expect((await getDebate(failed.id))?.recovery?.available).toBe(false);
    expect(await retryDebate("missing", 0)).toBeNull();
  });
});

describe("reading level and follow-ups", () => {
  it("preserves the selected reading level through retries and follow-up saves", async () => {
    const started = await startDebate({ subject: "Should schools have longer recess?", readingLevel: "12-14" });
    await expect(started.completion).rejects.toThrow();
    api.failBefore = null;
    api.loseJobs();
    await retryDebate(started.debate.id, 0);
    await waitForTerminal(started.debate.id);
    const exchange = await addFollowup(started.debate.id, "What matters most?");
    expect(exchange?.answer).toBe("The green frog had the stronger reason.");

    const policies = [...api.posts("/v1/jobs").map((call) => call.body.options), ...api.posts("/v1/followups").map((call) => call.body)]
      .map((body) => JSON.stringify(body.provider.promptPolicy));
    expect(policies).toHaveLength(3);
    expect(policies.every((policy) => policy.includes("13-year-old") && !policy.includes("10-year-old"))).toBe(true);
    const followup = api.posts("/v1/followups")[0].body;
    expect(followup.context).toMatchObject({ subject: "Should schools have longer recess?" });
    expect(followup.context.turns).toHaveLength(9);
    expect(followup.fallbackAnswer).toContain("Here is what the judge said");

    const saved = control.records.get(started.debate.id);
    expect(saved).toHaveProperty("readingLevel", "12-14");
    expect(saved).toHaveProperty("retryState");
    expect(saved?.followups).toHaveLength(1);
    expect((await getDebate(started.debate.id))?.readingLevel).toBe("12-14");
  });

  it("answers from the saved verdict when the API cannot", async () => {
    api.failBefore = null;
    const started = await startDebate(homework);
    await started.completion;
    api.routes["/v1/followups"] = () => Response.json({ error: "Unavailable" }, { status: 503 });
    expect((await addFollowup(started.debate.id, "What could change your mind?"))?.answer)
      .toContain("Here is what could change the answer");
    expect(await addFollowup("missing", "What matters most?")).toBeNull();
  });
});
