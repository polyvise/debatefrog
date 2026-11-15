import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/llm/route";
import { generateChecked, GenerationFailure, resetEngineRuntime } from "@/server/checked-generation";
import { FAKE_API_URL, fixtures, installFakeApi, type FakeApi } from "./helpers/fake-api";

const turn = { round: "opening", agentId: "pro", agentName: "Yes Frog", side: "pro", content: "I support longer recess because we need time to rest.", claimIds: [], sourceIds: [] as string[] };
const data = { turns: [turn] };
const wordy = { turns: [{ ...turn, content: "More time outside helps us rest. ".repeat(8).trim() }] };
const invented = { turns: [{ ...turn, sourceIds: ["invented"] }] };
const request = {
  role: "pro advocate opening round", schemaName: "debateTurnOutput", model: "openai/gpt-4o-mini",
  jsonSchema: { type: "object" }, prompt: JSON.stringify({ round: "opening", sources: [] })
};
const snapshot = (attempts = 1) => ({
  id: "test", provider: "openrouter", model: request.model, role: request.role, configured: true,
  promptTokens: 10, completionTokens: 5, estimatedCostUsd: 0.001,
  attempts: Array.from({ length: attempts }, (_, index) => ({
    attempt: index + 1, mode: "json_object", status: index === attempts - 1 ? "ok" : "failed", durationMs: 5
  }))
});
const answer = (output: unknown, attempts = 1) => ({ data: output, snapshot: snapshot(attempts) });
const outage = (attempts = 1) => Response.json(
  { error: "Provider failure 503", snapshot: { ...snapshot(attempts), estimatedCostUsd: undefined, failure: "Provider failure 503" } },
  { status: 502 }
);

let api: FakeApi;
/** Queues the API's answers to successive model calls. */
function modelAnswers(...answers: unknown[]) {
  // The last answer repeats, like a mock that always resolves the same way.
  api.routes["/v1/generate"] = () => (answers.length > 1 ? answers.shift() : answers[0]);
}
const modelCalls = () => api.posts("/v1/generate");

beforeEach(() => {
  resetEngineRuntime();
  api = installFakeApi();
  api.routes["/v1/config"] = { ...fixtures.runtime, config: { ...fixtures.runtime.config, enableMockLlm: false } };
  api.routes["/v1/schemas/debateTurnOutput/validate"] = ({ data: output }: { data: typeof data }) =>
    output.turns.every((item) => item.side === "pro" || item.side === "con")
      ? { valid: true, data: output }
      : { valid: false, issues: [{ path: ["turns", "0", "side"], message: "Input should be 'pro', 'con' or 'neutral'" }] };
  api.routes["/v1/schemas/finalSummaryOutput/validate"] = ({ data: output }: { data: unknown }) => ({ valid: true, data: output });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("checked model calls", () => {
  it("asks the API for the routed model in JSON-object mode with bounded transport retries", async () => {
    modelAnswers(answer(data));
    expect(await generateChecked(request)).toEqual(answer(data));
    expect(modelCalls()).toHaveLength(1);
    expect(modelCalls()[0].body).toMatchObject({
      role: request.role, model: request.model, maxAttempts: 3,
      config: { llmMaxAttempts: 2, useStrictJsonSchema: false, llmTimeoutMs: 45000, apiRetryBaseDelayMs: 1000 }
    });
  });

  it("returns the engine's template untouched in mock mode", async () => {
    api.routes["/v1/config"] = fixtures.runtime;
    modelAnswers(answer(invented));
    expect((await generateChecked(request)).data).toEqual(invented);
    expect(modelCalls()).toHaveLength(1);
    expect(modelCalls()[0].body.config).not.toHaveProperty("enableMockLlm");
  });

  it("turns mock mode off for a development run that opted into live APIs", async () => {
    api.routes["/v1/config"] = fixtures.runtime;
    modelAnswers(answer(data));
    await generateChecked(request, "9-11", true);
    expect(modelCalls()[0].body.config).toMatchObject({ enableMockLlm: false, allowDeterministicFallbacks: false });
  });

  it("rewrites an overlong turn once and returns the shorter answer intact", async () => {
    modelAnswers(answer(wordy), answer(data));
    const result = await generateChecked(request);
    expect(modelCalls()).toHaveLength(2);
    const repair = JSON.parse(modelCalls()[1].body.prompt);
    expect(repair.outputToRepair).toEqual(wordy);
    expect(repair.semanticRepairRequired).toEqual([expect.stringContaining("35 words or fewer")]);
    // A style rewrite is optional, so it gets one call and no transport retries.
    expect(modelCalls()[1].body.config.llmMaxAttempts).toBe(1);
    expect(result.data).toEqual(data);
    expect(result.snapshot).toMatchObject({ promptTokens: 20, completionTokens: 10, estimatedCostUsd: 0.002 });
    expect(result.snapshot.attempts?.map((attempt) => attempt.status)).toEqual(["failed", "ok"]);
  });

  it("does not discard or truncate a complete debate if the rewrite is still wordy", async () => {
    modelAnswers(answer(wordy));
    const result = await generateChecked(request);
    expect(modelCalls()).toHaveLength(2);
    expect(result.data).toEqual(wordy);
  });

  it("keeps a usable original when an optional rewrite hits an outage", async () => {
    modelAnswers(answer(wordy), outage());
    const result = await generateChecked(request);
    expect(result.data).toEqual(wordy);
    expect(result.snapshot.failure).toBeUndefined();
    expect(result.snapshot.attempts).toHaveLength(2);
  });

  it("keeps a usable original when the optional rewrite introduces unsupported evidence", async () => {
    modelAnswers(answer(wordy), answer(invented));
    const result = await generateChecked(request);
    expect(result.data).toEqual(wordy);
    expect(result.snapshot.estimatedCostUsd).toBe(0.002);
  });

  it("keeps a usable answer when no budget remains for a style rewrite", async () => {
    modelAnswers(answer(wordy));
    expect((await generateChecked({ ...request, maxAttempts: 1 })).data).toEqual(wordy);
    expect(modelCalls()).toHaveLength(1);
  });

  it("still rejects unsupported citations after the rewrite", async () => {
    modelAnswers(answer(invented));
    await expect(generateChecked(request)).rejects.toThrow("unknown source id");
    expect(modelCalls()).toHaveLength(2);
  });

  it("does not start an output repair after the shared budget is spent", async () => {
    modelAnswers(answer(invented));
    await expect(generateChecked({ ...request, maxAttempts: 1 })).rejects.toThrow("unknown source id");
    expect(modelCalls()).toHaveLength(1);
  });

  it("shares three calls across transport recovery and output repair", async () => {
    modelAnswers(answer(invented, 2), outage());
    const error = await generateChecked(request).catch((failure: GenerationFailure) => failure);
    expect(error).toBeInstanceOf(GenerationFailure);
    expect(modelCalls()[1].body).toMatchObject({ maxAttempts: 1, config: { llmMaxAttempts: 1 } });
    expect((error as GenerationFailure).snapshot?.attempts?.map((attempt) => attempt.attempt)).toEqual([1, 2, 3]);
    expect((error as GenerationFailure).snapshot?.estimatedCostUsd).toBe(0.001);
  });

  it("repairs invalid structure with the shared schema's feedback", async () => {
    modelAnswers(answer({ turns: [{ ...turn, side: "green" }] }), answer(data));
    const result = await generateChecked(request);
    const repair = modelCalls()[1].body.prompt;
    expect(repair).toContain("outputToRepair");
    expect(repair).toContain("Schema: turns.0.side");
    expect(result.data).toEqual(data);
  });

  it("does not repeatedly repair a supported percentage written differently in the source", async () => {
    const output = { turns: [{ ...turn,
      content: "I disagree because a Hill-HarrisX poll found that 84% of registered voters opposed lowering the voting age.",
      sourceIds: ["poll"]
    }] };
    modelAnswers(answer(output));
    const result = await generateChecked({ ...request, prompt: JSON.stringify({
      round: "opening", sources: [{ id: "poll", snippet: "A Hill-HarrisX poll found that 84 percent of registered voters opposed lowering the voting age to 16." }]
    }) });
    expect(result.data).toEqual(output);
    expect(modelCalls()).toHaveLength(1);
  });

  it("gives the judge its rejected summary to shorten before completing", async () => {
    const summary = {
      headline: "Less homework wins",
      recommendation: "The green frog made a strong point about giving children more time to rest. ".repeat(5),
      strongestPro: ["Children need time to rest."], strongestCon: ["Practice helps children learn."],
      unresolvedUncertainties: [], whatWouldChangeMind: [], confidence: 0.7
    };
    const repaired = { ...summary, recommendation: "The green frog wins because rest matters. Practice helps too, but children need time to play after school." };
    modelAnswers(answer(summary), answer(repaired));
    const result = await generateChecked({ ...request, role: "final summary", schemaName: "finalSummaryOutput" });
    expect(result.data).toEqual(repaired);
    const prompt = JSON.parse(modelCalls()[1].body.prompt);
    expect(prompt.outputToRepair).toEqual(summary);
    expect(prompt.semanticRepairRequired.join(" ")).toMatch(/recommendation/i);
    expect(prompt.semanticRepairRequired.join(" ")).toContain("320");
  });

  it("refuses schemas Debatefrog has no checks for", async () => {
    await expect(generateChecked({ ...request, schemaName: "panelAdviceOutput" })).rejects.toThrow("Unsupported");
    expect(modelCalls()).toHaveLength(0);
  });
});

describe("the API's model-call callback", () => {
  const call = (headers: Record<string, string> = {}, body: unknown = request, query = "") =>
    POST(new Request(`https://debatefrog.test/api/llm${query}`, { method: "POST", headers, body: JSON.stringify(body) }));

  it("answers a model call with checked data and its snapshot", async () => {
    vi.stubEnv("POLYVISE_API_KEY", "secret-key");
    modelAnswers(answer(data));
    const response = await call({ Authorization: "Bearer secret-key" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(answer(data));
    expect(modelCalls()[0].headers.get("authorization")).toBe("Bearer secret-key");
  });

  it("checks against the reading level the run was started with", async () => {
    const older = { turns: [{ ...turn, content: `${"word ".repeat(39)}done.` }] };
    modelAnswers(answer(older));
    await call({}, request, "?level=12-14");
    expect(modelCalls()).toHaveLength(1);
  });

  it("only accepts the Polyvise API's key", async () => {
    vi.stubEnv("POLYVISE_API_KEY", "secret-key");
    expect((await call()).status).toBe(401);
    expect((await call({ Authorization: "Bearer wrong-key!" })).status).toBe(401);
    expect(modelCalls()).toHaveLength(0);
  });

  it("is closed in production when no key is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await call()).status).toBe(401);
  });

  it("rejects a malformed call", async () => {
    expect((await call({}, { role: "judge" })).status).toBe(400);
  });

  it("reports a failed call with its snapshot so the engine can record it", async () => {
    modelAnswers(outage());
    const response = await call();
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "Provider failure 503", snapshot: { failure: "Provider failure 503" } });
    expect(api.calls.every((item) => `${FAKE_API_URL}${item.path}`.startsWith(FAKE_API_URL))).toBe(true);
  });
});
