import type {
  DebateRecord,
  DebateRequest,
  DebateRun,
  FramedDebate,
  ModelSnapshot,
  UserFeedback
} from "@/lib/polyvise-api/types";

/**
 * The one place this app talks to the Polyvise API.
 *
 * Every model call, shared schema and engine step lives behind that service;
 * this module only knows its URLs and the shape of what comes back.
 */

const DEFAULT_API_URL = "https://api.polyvise.ai";
const DEFAULT_TIMEOUT_MS = 30_000;
/** One model call with its transport retries, or a follow-up with a repair. */
const MODEL_CALL_TIMEOUT_MS = 180_000;

export function polyviseApiUrl(): string {
  return (process.env.POLYVISE_API_URL?.trim() || DEFAULT_API_URL).replace(/\/+$/, "");
}

export function polyviseApiKey(): string | undefined {
  return process.env.POLYVISE_API_KEY?.trim() || undefined;
}

export interface ApiIssue {
  path: string[];
  message: string;
}

/** A non-2xx answer from the API. `issues` is present when the request itself was invalid. */
export class PolyviseApiError extends Error {
  readonly issues?: ApiIssue[];

  constructor(
    readonly status: number,
    message: string,
    readonly body: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "PolyviseApiError";
    if (Array.isArray(body.issues)) this.issues = body.issues as ApiIssue[];
  }

  /** The caller sent something the API's contract rejects, as opposed to the API failing. */
  get invalidRequest(): boolean {
    return this.status === 422;
  }

  get notFound(): boolean {
    return this.status === 404;
  }
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const key = polyviseApiKey();
  return { Accept: "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}), ...extra };
}

async function failure(response: Response): Promise<PolyviseApiError> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const message =
    typeof body.error === "string" && body.error ? body.error : `The Polyvise API answered ${response.status}.`;
  return new PolyviseApiError(response.status, message, body);
}

async function request<T>(path: string, options: { body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const response = await fetch(`${polyviseApiUrl()}${path}`, {
    method: options.body === undefined ? "GET" : "POST",
    headers: headers(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as T;
}

// ------------------------------------------------------- provider options

/** Any subset of the engine's runtime config, applied on top of the API's environment. */
export interface RuntimeConfigOverrides {
  quickModel?: string;
  deepModel?: string;
  yesModel?: string;
  noModel?: string;
  judgeModel?: string;
  maxRounds?: number;
  llmTimeoutMs?: number;
  llmMaxAttempts?: number;
  llmMaxTokens?: number;
  apiRetryBaseDelayMs?: number;
  evidenceProvider?: "mock" | "brave" | "tavily";
  enableMockLlm?: boolean;
  allowDeterministicFallbacks?: boolean;
  useStrictJsonSchema?: boolean;
}

/** Routes any role containing one of `contains` to `model`; first match wins. */
export interface ModelRouting {
  rules: { contains: string[]; model: string }[];
  defaultModel?: string;
}

/** Edits to the `rules` array of every JSON prompt in a run. */
export interface PromptPolicy {
  removeRulesStartingWith: string[];
  appendRules: string[];
  rulesBySchema: Record<string, string[]>;
  rulesByRound: Record<string, string[]>;
}

export interface ProviderOptions {
  routing?: ModelRouting;
  promptPolicy?: PromptPolicy;
  /** Delegates each model call to this app, which checks and repairs the output. */
  callback?: { url: string; headers?: Record<string, string>; timeoutMs?: number };
}

/** A run's saved steps. Opaque here: only the API reads it. */
export type RunCheckpoint = Record<string, unknown>;

export interface RunOptions {
  streamTurns?: boolean;
  checkpoint?: RunCheckpoint;
  config?: RuntimeConfigOverrides;
  provider?: ProviderOptions;
}

// ------------------------------------------------------------------ runs

export interface JobFailure {
  message: string;
  /** A short description (model, step, and why). */
  summary: string;
  step: string;
  failedStep?: string;
  model?: string;
  snapshot?: ModelSnapshot;
}

export interface JobStatus {
  debateId: string;
  attempt: number;
  status: "running" | "complete" | "failed";
  mode: string;
  framed: FramedDebate;
  createdAt: string;
  updatedAt: string;
  run?: DebateRun;
  failure?: JobFailure;
  resumable: boolean;
}

/** The queued record to persist before a run starts, and the request as the API parsed it. */
export function seedRecord(input: unknown): Promise<{ record: DebateRecord; request: DebateRequest }> {
  return request("/v1/records", { body: input ?? {} });
}

/** Starts a run in the background on the API. Its events arrive from `jobEvents`. */
export function startJob(debateId: string, runRequest: DebateRequest, options: RunOptions): Promise<{ attempt: number }> {
  return request("/v1/jobs", { body: { request: runRequest, debateId, options } });
}

/** Resumes a failed job from the steps the API still holds. `attempt` is the API's, from `getJob`. */
export function resumeJob(debateId: string, attempt: number): Promise<{ attempt: number }> {
  return request(`/v1/jobs/${encodeURIComponent(debateId)}/resume`, { body: { attempt } });
}

export function getJob(debateId: string): Promise<JobStatus> {
  return request(`/v1/jobs/${encodeURIComponent(debateId)}`);
}

export async function getJobCheckpoint(debateId: string): Promise<RunCheckpoint | undefined> {
  const { checkpoint } = await request<{ checkpoint: RunCheckpoint | null }>(
    `/v1/jobs/${encodeURIComponent(debateId)}/checkpoint`
  );
  return checkpoint ?? undefined;
}

/** Runs a debate to completion in one request. Used by the model evaluation script. */
export async function runDebate(
  runRequest: DebateRequest,
  options: RunOptions,
  { debateId, timeoutMs }: { debateId?: string; timeoutMs: number }
): Promise<DebateRun> {
  const { run } = await request<{ run: DebateRun }>("/v1/runs", {
    body: { request: runRequest, debateId, options },
    timeoutMs
  });
  return run;
}

export interface ApiEvent {
  /** `<attempt>:<n>`; absent on the terminating `closed` event. */
  id?: string;
  name: string;
  data: unknown;
}

/**
 * A job's server-sent events: the attempt so far, then live ones, ending with
 * `closed`. Pass the last `id` seen to receive only what followed it.
 */
export async function* jobEvents(debateId: string, after?: string): AsyncGenerator<ApiEvent> {
  // Aborting releases the connection when the caller stops reading early.
  const connection = new AbortController();
  try {
    const response = await fetch(`${polyviseApiUrl()}/v1/jobs/${encodeURIComponent(debateId)}/events`, {
      headers: headers({ Accept: "text/event-stream", ...(after ? { "Last-Event-ID": after } : {}) }),
      cache: "no-store",
      signal: connection.signal
    });
    if (!response.ok || !response.body) throw await failure(response);
    yield* parseEventStream(response.body);
  } finally {
    connection.abort();
  }
}

export async function* parseEventStream(body: ReadableStream<Uint8Array>): AsyncGenerator<ApiEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const blocks = pending.split(/\r?\n\r?\n/);
      pending = done ? "" : (blocks.pop() ?? "");
      for (const block of blocks) {
        const event = parseEventBlock(block);
        if (event) yield event;
      }
      if (done) return;
    }
  } finally {
    // Not awaited: cancelling a body that is still open can wait on the server.
    void reader.cancel().catch(() => {});
  }
}

function parseEventBlock(block: string): ApiEvent | null {
  let id: string | undefined;
  let name = "message";
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue; // blank or a keep-alive comment
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "id") id = value;
    else if (field === "event") name = value;
    else if (field === "data") data.push(value);
  }
  if (!data.length) return null;
  try {
    return { id, name, data: JSON.parse(data.join("\n")) };
  } catch {
    return null;
  }
}

// ----------------------------------------------------- single model calls

/** One model call as the engine describes it (the API's `LlmRequest`). */
export interface LlmCall {
  role: string;
  schemaName: string;
  prompt: string;
  jsonSchema?: Record<string, unknown>;
  fallback?: unknown;
  sessionId?: string;
  model?: string;
  /** HTTP calls this step may still make, including output repair. */
  maxAttempts?: number;
}

export interface LlmResult<T = unknown> {
  data: T;
  snapshot: ModelSnapshot;
}

/** One structured model call, with the API's bounded transport retries. A failure is a `PolyviseApiError`. */
export function generate<T>(call: LlmCall, config: RuntimeConfigOverrides): Promise<LlmResult<T>> {
  return request("/v1/generate", { body: { ...call, config }, timeoutMs: MODEL_CALL_TIMEOUT_MS });
}

/** Checks `data` against one of the engine's output schemas. */
export function validateOutput(
  schemaName: string,
  data: unknown
): Promise<{ valid: boolean; data?: unknown; issues?: ApiIssue[] }> {
  return request(`/v1/schemas/${encodeURIComponent(schemaName)}/validate`, { body: { data } });
}

export interface FollowupAnswer {
  answer: string;
  /** False when the API fell back to the answer this app supplied. */
  generated: boolean;
}

export function answerFollowup(
  input: { question: string; fallbackAnswer: string; context: Record<string, unknown> },
  options: Pick<RunOptions, "config" | "provider">
): Promise<FollowupAnswer> {
  return request("/v1/followups", { body: { ...input, ...options }, timeoutMs: MODEL_CALL_TIMEOUT_MS });
}

/** Validates feedback and returns the record to store. */
export async function normalizeFeedback(input: Record<string, unknown>): Promise<UserFeedback> {
  const { feedback } = await request<{ feedback: UserFeedback }>("/v1/feedback", { body: input });
  return feedback;
}

// -------------------------------------------------------------- reference

export interface ModelOption {
  id: string;
  label: string;
}

/** The engine's model choices, plus `include` (this app's own defaults) with catalog labels. */
export async function getModelOptions(include: string[]): Promise<ModelOption[]> {
  const { options } = await request<{ options: ModelOption[] }>(
    `/v1/model-options?include=${encodeURIComponent(include.join(","))}`,
    { timeoutMs: 10_000 }
  );
  return options;
}

export interface ApiRuntime {
  production: boolean;
  /** Whether each upstream provider has a key configured on the API. */
  providers: { openrouter: boolean; tavily: boolean; brave: boolean };
  config: {
    enableMockLlm: boolean;
    llmMaxAttempts: number;
    llmTimeoutMs: number;
    apiRetryBaseDelayMs: number;
  };
}

export function getRuntime(): Promise<ApiRuntime> {
  return request("/v1/config", { timeoutMs: 10_000 });
}
