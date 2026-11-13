import { DEFAULT_READING_LEVEL } from "@/lib/reading-level";
import { randomUUID } from "node:crypto";
import { LlmProviderFailure } from "@polyvise/core/providers/llm";
import {
  loadDebateRuntimeConfig,
  type DebateRuntimeConfig
} from "@polyvise/core/debate/config";
import { feedbackRequestSchema, followupOutputSchema } from "@polyvise/core/debate/schema";
import {
  frameDebateRequest,
  productNotes,
  runHybridCouncilDebate
} from "@polyvise/core/debate/engine";
import type { DebateCheckpoint } from "@polyvise/core/debate/engine";
import type { RecoverableDebateRecord } from "@/lib/debate-recovery";
import { createDefaultDebateRepository, createDefaultFeedbackRepository } from "./repository";
import type {
  DebateLiveEvent,
  DebateRecord,
  DebateRequest,
  FollowupExchange,
  ModelSnapshot,
  UserFeedback
} from "@polyvise/core/debate/types";
import {
  resolveDebateStepModelDefaults,
  resolveDebateStepModels,
  type DebateStepModelSelections,
  type PartialDebateStepModelSelections
} from "@/lib/debate-step-models";
import {
  debatefrogRequestSchema,
  toCoreDebateRequest,
  type DebatefrogRequest
} from "@/server/debate-request";
import { RoundModelLlmProvider } from "@/server/round-model-provider";

const repository = createDefaultDebateRepository();
const feedbackRepository = createDefaultFeedbackRepository();
export const DEBATE_UNAVAILABLE_MESSAGE =
  "The frogs couldn't finish this step. You can try it again.";
export const DEBATE_JUDGE_UNAVAILABLE_MESSAGE =
  "The judge frog couldn't finish this step. You can try it again.";

type StoredDebateRecord = RecoverableDebateRecord & {
  retryState?: {
    request: DebateRequest;
    config: DebateRuntimeConfig;
    stepModels: DebateStepModelSelections;
    checkpoint?: DebateCheckpoint;
    events: DebateLiveEvent[];
    attempt: number;
  };
};

function publicDebate(record: StoredDebateRecord): RecoverableDebateRecord {
  const { retryState, ...debate } = record;
  return {
    ...debate,
    recovery: { attempt: retryState?.attempt ?? 0, available: Boolean(retryState) },
    ...(!record.latestRun && retryState ? { liveEvents: retryState.events } : {})
  };
}

type Listener = (event: DebateLiveEvent) => void;

class DebateEventBus {
  readonly buffer: DebateLiveEvent[] = [];
  private listeners = new Set<Listener>();
  private terminal = false;
  constructor(readonly attempt = 0) {}

  emit(event: DebateLiveEvent): void {
    this.buffer.push(event);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // listener errors should not break the run
      }
    }
    if (event.kind === "complete" || event.kind === "error") {
      this.terminal = true;
    }
  }

  subscribe(listener: Listener): () => void {
    // replay buffered events so a late subscriber catches up
    for (const event of this.buffer) {
      try {
        listener(event);
      } catch {
        // ignore
      }
    }
    if (this.terminal) {
      return () => {};
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  isTerminal(): boolean {
    return this.terminal;
  }
}

const buses = new Map<string, DebateEventBus>();

function scheduleBusCleanup(id: string, delayMs = 5 * 60 * 1000): void {
  const bus = buses.get(id);
  setTimeout(() => {
    if (buses.get(id) === bus) buses.delete(id);
  }, delayMs).unref?.();
}

function buildSeedRecord(input: DebatefrogRequest): {
  record: StoredDebateRecord;
  request: DebateRequest;
  config: DebateRuntimeConfig;
  stepModels: DebateStepModelSelections;
  framed: ReturnType<typeof frameDebateRequest>;
} {
  const parsed = debatefrogRequestSchema.parse(input) as DebatefrogRequest;
  const request = toCoreDebateRequest(parsed);
  const id = `debate_${randomUUID().slice(0, 10)}`;
  const framed = frameDebateRequest(request);
  const createdAt = new Date().toISOString();
  const record: StoredDebateRecord = {
    readingLevel: parsed.readingLevel ?? DEFAULT_READING_LEVEL,
    id,
    subject: framed.subject,
    context: framed.context,
    mode: request.mode,
    evidence: request.evidence,
    status: "queued",
    resolution: framed.resolution,
    topicKind: framed.topicKind,
    highStakes: framed.highStakes,
    createdAt,
    updatedAt: createdAt,
    productNotes: productNotes(),
    followups: []
  };

  const baseConfig = loadDebateRuntimeConfig();
  const defaults = resolveDebateStepModelDefaults();
  const requestedStepModels = stepModelsFromRequest(parsed.models);
  const stepModels = resolveDebateStepModels(requestedStepModels, defaults);
  const config: DebateRuntimeConfig = {
    ...baseConfig,
    // Debatefrog's public transcript promises four frog rounds. Do not let a
    // legacy shared-core default silently omit Closing / Last Word.
    maxRounds: 4,
    quickModel: stepModels.opening,
    deepModel: stepModels.rebuttal,
    // Team metadata has one model field per frog. Opening is the least
    // surprising representative value; actual calls are routed per round.
    yesModel: stepModels.opening,
    noModel: stepModels.opening,
    judgeModel: stepModels.judge
  };

  return {
    record,
    request,
    config: configWithDevOverrides(config, request),
    stepModels,
    framed
  };
}

function stepModelsFromRequest(
  models: DebatefrogRequest["models"]
): PartialDebateStepModelSelections | undefined {
  if (!models) return undefined;

  const mirroredLegacyModel =
    models.yes?.trim() && models.yes.trim() === models.no?.trim()
      ? models.yes.trim()
      : undefined;

  return {
    opening: models.opening?.trim() || mirroredLegacyModel || models.quick?.trim(),
    crossExamination:
      models.crossExamination?.trim() || mirroredLegacyModel || models.quick?.trim(),
    rebuttal: models.rebuttal?.trim() || mirroredLegacyModel || models.deep?.trim(),
    closing: models.closing?.trim() || mirroredLegacyModel || models.deep?.trim(),
    judge: models.judge?.trim()
  };
}

function configWithDevOverrides(config: DebateRuntimeConfig, request: DebateRequest): DebateRuntimeConfig {
  if (process.env.NODE_ENV === "production" || !request.devOptions?.liveApis) {
    return config;
  }

  return {
    ...config,
    evidenceProvider: "tavily",
    enableMockLlm: false,
    allowDeterministicFallbacks: false
  };
}

export interface StartDebateResult {
  debate: DebateRecord;
  completion: Promise<DebateRecord>;
}

export async function startDebate(input: DebatefrogRequest): Promise<StartDebateResult> {
  const { record, request, config, stepModels } = buildSeedRecord(input);
  const stored: StoredDebateRecord = {
    ...record, retryState: { request, config, stepModels, events: [], attempt: 0 }
  };
  await repository.save(stored);
  const completion = executeDebate(stored);
  return { debate: publicDebate(stored), completion };
}

function nextUpdatedAt(previous: string): string {
  return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
}

export async function retryDebate(id: string, attempt: number): Promise<{ debate: RecoverableDebateRecord; accepted: boolean } | null> {
  const record = await repository.get(id) as StoredDebateRecord | null;
  if (!record) return null;
  if (record.status === "complete") return { debate: publicDebate(record), accepted: true };
  if (!record.retryState) return { debate: publicDebate(record), accepted: false };
  const inactive = record.status === "failed" || record.status === "partial" || Date.now() - Date.parse(record.updatedAt) >= 5 * 60_000;
  if (!inactive) return { debate: publicDebate(record), accepted: true };
  if (record.retryState.attempt !== attempt) return { debate: publicDebate(record), accepted: false };
  const resumed: StoredDebateRecord = {
    ...record, status: "queued", updatedAt: nextUpdatedAt(record.updatedAt),
    retryState: { ...record.retryState, attempt: attempt + 1 }
  };
  if (!await repository.saveIfUnchanged(resumed, record.updatedAt)) {
    const current = await repository.get(id) as StoredDebateRecord | null;
    return current ? { debate: publicDebate(current), accepted: current.status !== "failed" } : null;
  }
  void executeDebate(resumed);
  return { debate: publicDebate(resumed), accepted: true };
}

function executeDebate(seed: StoredDebateRecord): Promise<DebateRecord> {
  let record = seed;
  const { request, config, stepModels } = record.retryState!;
  let checkpoint = record.retryState!.checkpoint;
  let stage: DebateRecord["status"] = record.status;
  const bus = new DebateEventBus(record.retryState!.attempt);
  buses.set(record.id, bus);
  const persist = async (status: DebateRecord["status"], latestRun = record.latestRun) => {
    const next: StoredDebateRecord = {
      ...record, status, latestRun, updatedAt: nextUpdatedAt(record.updatedAt),
      retryState: { ...record.retryState!, checkpoint, events: [...bus.buffer] }
    };
    if (!await repository.saveIfUnchanged(next, record.updatedAt)) {
      throw new Error("This debate attempt was replaced by another request.");
    }
    record = next;
    return publicDebate(record);
  };

  const completion = (async (): Promise<DebateRecord> => {
    try {
      const run = await runHybridCouncilDebate(record.id, request, frameDebateRequest(request), {
        config,
        checkpoint,
        onCheckpoint: async (value) => {
          checkpoint = value;
          await persist(stage);
        },
        streamTurns: true,
        provider: new RoundModelLlmProvider(config, stepModels, record.readingLevel),
        emit: (event) => {
          // Publish completion only after the durable result is available.
          if (event.kind === "complete" || (event.kind === "stage" && event.status === "complete")) return;
          if (event.kind === "stage") stage = event.status;
          bus.emit(event);
        }
      });
      const completed = await persist(run.status, run);
      bus.emit({ kind: "stage", status: "complete" });
      bus.emit({ kind: "complete", runId: run.id });
      scheduleBusCleanup(record.id);
      return completed;
    } catch (error) {
      const failedSnapshot = modelSnapshotFromError(error);
      console.error("[debatefrog.run.failed]", {
        debateId: record.id,
        role: failedSnapshot?.role,
        model: failedSnapshot?.model,
        attempts: failedSnapshot?.attempts?.length,
        name: error instanceof Error ? error.name : "UnknownError",
        message:
          error instanceof Error
            ? error.message.replace(/sk-or-v1-[a-zA-Z0-9_-]+/g, "[redacted-api-key]").slice(0, 1000)
            : "Unknown debate workflow failure."
      });
      if (failedSnapshot) {
        bus.emit({ kind: "model_snapshot", snapshot: failedSnapshot });
      }
      try {
        await persist("failed");
      } finally {
        bus.emit({ kind: "error", message: stage === "judging" ? DEBATE_JUDGE_UNAVAILABLE_MESSAGE : DEBATE_UNAVAILABLE_MESSAGE });
        scheduleBusCleanup(record.id);
      }
      throw error;
    }
  })();

  // Prevent unhandled rejection warnings when callers only consume via SSE.
  completion.catch(() => {});

  return completion;
}

function modelSnapshotFromError(error: unknown): ModelSnapshot | null {
  if (error instanceof LlmProviderFailure) {
    return error.snapshot;
  }
  return null;
}

export async function createDebate(input: DebatefrogRequest): Promise<DebateRecord> {
  const { completion } = await startDebate(input);
  return completion;
}

export function subscribeToDebate(
  debateId: string,
  listener: Listener,
  attempt?: number
): { unsubscribe: () => void; terminal: boolean } {
  const bus = buses.get(debateId);
  if (!bus || (attempt !== undefined && bus.attempt !== attempt)) {
    return { unsubscribe: () => {}, terminal: true };
  }
  const unsubscribe = bus.subscribe(listener);
  return { unsubscribe, terminal: bus.isTerminal() };
}

export async function getDebate(id: string): Promise<RecoverableDebateRecord | null> {
  const record = await repository.get(id) as StoredDebateRecord | null;
  return record ? publicDebate(record) : null;
}

export function listDebates(): Promise<DebateRecord[]> {
  return repository.list();
}

export async function submitFeedback(input: {
  app?: string;
  message: string;
  debateId?: string;
  pagePath?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}): Promise<UserFeedback> {
  const parsed = feedbackRequestSchema.parse(input);
  const feedback: UserFeedback = {
    id: `feedback_${randomUUID().slice(0, 12)}`,
    app: input.app?.trim() || "debatefrog",
    message: parsed.message,
    debateId: parsed.debateId || undefined,
    pagePath: parsed.pagePath || undefined,
    userAgent: input.userAgent?.trim() || undefined,
    metadata: input.metadata ?? {},
    createdAt: new Date().toISOString()
  };

  await feedbackRepository.save(feedback);
  return feedback;
}

export function listFeedback(): Promise<UserFeedback[]> {
  return feedbackRepository.list();
}

export async function addFollowup(debateId: string, question: string): Promise<FollowupExchange | null> {
  const debate = await repository.get(debateId) as StoredDebateRecord | null;
  if (!debate?.latestRun) {
    return null;
  }

  const answer = await answerFollowup(question, debate);
  const exchange: FollowupExchange = {
    id: `followup_${randomUUID().slice(0, 8)}`,
    question,
    answer,
    createdAt: new Date().toISOString()
  };

  const updated = {
    ...debate,
    followups: [...debate.followups, exchange],
    updatedAt: new Date().toISOString()
  };
  await repository.save(updated);

  return exchange;
}

async function answerFollowup(question: string, debate: StoredDebateRecord): Promise<string> {
  const fallback = {
    answer: answerFollowupDeterministic(question, debate)
  };

  try {
    const provider = new RoundModelLlmProvider(loadDebateRuntimeConfig(), resolveDebateStepModelDefaults(), debate.readingLevel);
    const result = await provider.generateStructured<unknown>({
      role: "follow-up answer",
      schemaName: "followupOutput",
      fallback,
      prompt: JSON.stringify({ question, subject: debate.subject, summary: debate.latestRun?.summary, sources: debate.latestRun?.sources, turns: debate.latestRun?.turns, ...fallback })
    });
    return followupOutputSchema.parse(result.data).answer;
  } catch {
    return fallback.answer;
  }
}

function answerFollowupDeterministic(question: string, debate: DebateRecord): string {
  const lowered = question.toLowerCase();
  const summary = debate.latestRun?.summary;

  if (!summary) {
    return "The debate is not finished yet. Ask again after the judge gives a verdict.";
  }

  if (lowered.includes("change") || lowered.includes("mind")) {
    return `Here is what could change the answer: ${summary.whatWouldChangeMind.join(" ")}`;
  }

  if (lowered.includes("risk") || lowered.includes("downside")) {
    return `The other frog’s main concern was: ${summary.strongestCon[0] ?? "The debate did not give a clear concern."}`;
  }

  if (lowered.includes("source") || lowered.includes("evidence")) {
    const sources = debate.latestRun?.sources.slice(0, 3).map((source) => `${source.publisher}: ${source.title}`);
    return `These sources helped the frogs: ${sources?.join("; ")}.`;
  }

  return `Here is what the judge said: ${summary.recommendation}`;
}
