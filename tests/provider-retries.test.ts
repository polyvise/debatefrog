import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDebateRuntimeConfig } from "@polyvise/core/debate/config";
import { LlmProviderFailure } from "@polyvise/core/providers/llm";
import { generateStructured } from "@polyvise/core/runs/execution";
import { debateTurnOutputSchema } from "@polyvise/core/debate/schema";
import { resolveDebateStepModelDefaults } from "@/lib/debate-step-models";
import { RoundModelLlmProvider } from "@/server/round-model-provider";
import { fetchWithRetry } from "@/components/froglings-workspace";

const data = {
  turns: [{ round: "opening" as const, agentId: "pro", agentName: "Yes Frog", side: "pro" as const, content: "I support longer recess because we need time to rest.", claimIds: [], sourceIds: [] }]
};
const request = {
  role: "pro advocate opening round", schemaName: "debateTurnOutput",
  jsonSchema: { type: "object" }, prompt: JSON.stringify({ round: "opening", sources: [] })
};
const config = () => ({
  ...loadDebateRuntimeConfig({ NODE_ENV: "test" }), enableMockLlm: false, allowDeterministicFallbacks: false,
  llmMaxAttempts: 3, useStrictJsonSchema: true
});
const provider = () => new RoundModelLlmProvider(config(), resolveDebateStepModelDefaults({}));
const success = (output: unknown = data) => new Response(JSON.stringify({
  choices: [{ message: { content: JSON.stringify(output) } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 }
}));
const failure = (status: number) => new Response(JSON.stringify({ error: { message: `Provider failure ${status}` } }), { status });

describe("bounded model retries", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([400, 401, 402, 403, 404, 422])("does not retry HTTP %i or switch response formats", async (status) => {
    const fetch = vi.fn().mockResolvedValue(failure(status));
    vi.stubGlobal("fetch", fetch);
    await expect(provider().generateStructured(request)).rejects.toBeInstanceOf(LlmProviderFailure);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body).response_format).toEqual({ type: "json_object" });
  });

  it.each([408, 409, 429, 500, 502, 503])("retries transient HTTP %i after a delay", async (status) => {
    const fetch = vi.fn().mockResolvedValueOnce(failure(status)).mockResolvedValueOnce(success());
    vi.stubGlobal("fetch", fetch);
    const pending = provider().generateStructured(request);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.data).toEqual(data);
    expect(result.snapshot.attempts).toHaveLength(2);
  });

  it("stops after two transport timeouts", async () => {
    const fetch = vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("Timed out"), { name: "AbortError" })));
    }));
    vi.stubGlobal("fetch", fetch);
    const check = expect(provider().generateStructured(request)).rejects.toBeInstanceOf(LlmProviderFailure);
    await vi.runAllTimersAsync();
    await check;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors Core's remaining call budget for transport failures", async () => {
    const fetch = vi.fn().mockResolvedValue(failure(503));
    vi.stubGlobal("fetch", fetch);
    await expect(provider().generateStructured({ ...request, maxAttempts: 1 })).rejects.toBeInstanceOf(LlmProviderFailure);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not start an output repair after the shared budget is spent", async () => {
    const fetch = vi.fn().mockResolvedValue(success({ turns: [{ ...data.turns[0], sourceIds: ["invented"] }] }));
    vi.stubGlobal("fetch", fetch);
    await expect(provider().generateStructured({ ...request, maxAttempts: 1 })).rejects.toThrow("unknown source id");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not repeatedly repair a supported percentage written differently in the source", async () => {
    const output = { turns: [{ ...data.turns[0],
      content: "I disagree because a Hill-HarrisX poll found that 84% of registered voters opposed lowering the voting age.",
      sourceIds: ["poll"]
    }] };
    const fetch = vi.fn().mockResolvedValue(success(output));
    vi.stubGlobal("fetch", fetch);
    const result = await provider().generateStructured({ ...request, prompt: JSON.stringify({
      round: "opening", sources: [{ id: "poll", snippet: "A Hill-HarrisX poll found that 84 percent of registered voters opposed lowering the voting age to 16." }]
    }) });
    expect(result.data).toEqual(output);
    expect(result.snapshot.failure).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps a usable answer when no budget remains for a style rewrite", async () => {
    const wordy = { turns: [{ ...data.turns[0], content: "More time outside helps us rest. ".repeat(8).trim() }] };
    const fetch = vi.fn().mockResolvedValue(success(wordy));
    vi.stubGlobal("fetch", fetch);
    const result = await provider().generateStructured({ ...request, maxAttempts: 1 });
    expect(result.data).toEqual(wordy);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shares three calls across transport recovery and output repair", async () => {
    const invalid = { turns: [{ ...data.turns[0], sourceIds: ["made-up"] }] };
    const fetch = vi.fn()
      .mockResolvedValueOnce(failure(503))
      .mockResolvedValueOnce(success(invalid))
      .mockResolvedValueOnce(failure(503));
    vi.stubGlobal("fetch", fetch);
    const outcome = provider().generateStructured(request).catch((error: LlmProviderFailure) => error);
    await vi.runAllTimersAsync();
    const error = await outcome;
    expect(error).toBeInstanceOf(LlmProviderFailure);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect((error as LlmProviderFailure).snapshot.attempts?.map((attempt) => attempt.attempt)).toEqual([1, 2, 3]);
    expect((error as LlmProviderFailure).snapshot.estimatedCostUsd).toBe(0.001);
  });

  it("repairs invalid structure with specific feedback and totals both calls", async () => {
    const invalid = { turns: [{ ...data.turns[0], side: "green" }] };
    const fetch = vi.fn().mockResolvedValueOnce(success(invalid)).mockResolvedValueOnce(success());
    vi.stubGlobal("fetch", fetch);
    const result = await provider().generateStructured(request);
    const repair = JSON.parse(fetch.mock.calls[1][1].body).messages[1].content;
    expect(repair).toContain("outputToRepair");
    expect(repair).toContain("Schema: turns.0.side");
    expect(result.data).toEqual(data);
    expect(result.snapshot).toMatchObject({ promptTokens: 20, completionTokens: 10, estimatedCostUsd: 0.002 });
    expect(result.snapshot.attempts?.map((attempt) => attempt.status)).toEqual(["failed", "ok"]);
  });

  it("prevents the engine from starting another retry loop for invalid structure", async () => {
    const fetch = vi.fn(async () => success({ turns: [{ ...data.turns[0], side: "green" }] }));
    vi.stubGlobal("fetch", fetch);
    await expect(generateStructured(
      provider(), request.role, request.schemaName, data, debateTurnOutputSchema, config(), request.prompt
    )).rejects.toBeInstanceOf(LlmProviderFailure);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps a usable original when an optional rewrite hits an outage", async () => {
    const wordy = { turns: [{ ...data.turns[0], content: "More time outside helps us rest. ".repeat(8).trim() }] };
    const fetch = vi.fn().mockResolvedValueOnce(success(wordy))
      .mockResolvedValueOnce(failure(503));
    vi.stubGlobal("fetch", fetch);
    const pending = provider().generateStructured(request);
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(result.data).toEqual(wordy);
    expect(result.snapshot.failure).toBeUndefined();
    expect(result.snapshot.attempts).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps a usable original when the optional rewrite introduces unsupported evidence", async () => {
    const wordy = { turns: [{ ...data.turns[0], content: "More time outside helps us rest. ".repeat(8).trim() }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(success(wordy))
      .mockResolvedValueOnce(success({ turns: [{ ...data.turns[0], sourceIds: ["invented"] }] })));
    const result = await provider().generateStructured(request);
    expect(result.data).toEqual(wordy);
    expect(result.snapshot.estimatedCostUsd).toBe(0.002);
  });
});

describe("browser request retries", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(["/api/debates", "/api/feedback"])("does not duplicate POST %s on a network failure", async (url) => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("Connection lost"));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchWithRetry(url, { method: "POST" })).rejects.toThrow("Connection lost");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not duplicate a debate after a server error", async () => {
    const fetch = vi.fn().mockResolvedValue(failure(503));
    vi.stubGlobal("fetch", fetch);
    expect((await fetchWithRetry("/api/debates", { method: "POST" })).status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
