import { DEFAULT_READING_LEVEL } from "@/lib/reading-level";
import { randomUUID } from "node:crypto";
import type { RecoverableDebateRecord } from "@/lib/debate-recovery";
import { createDefaultDebateRepository, createDefaultFeedbackRepository } from "./repository";
import type {
  DebateLiveEvent,
  DebateRecord,
  DebateRequest,
  DebateRun,
  FollowupExchange,
  UserFeedback
} from "@/lib/polyvise-api/types";
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
import { providerOptions, runOptions } from "@/server/generation-policy";
import {
  answerFollowup,
  getJob,
  getJobCheckpoint,
  jobEvents,
  normalizeFeedback,
  PolyviseApiError,
  resumeJob,
  seedRecord,
  startJob,
  type JobFailure,
  type JobStatus,
  type RunCheckpoint
} from "@/server/polyvise-api";

const repository = createDefaultDebateRepository();
const feedbackRepository = createDefaultFeedbackRepository();
export const DEBATE_UNAVAILABLE_MESSAGE =
  "The frogs couldn't finish this step. You can try it again.";
export const DEBATE_JUDGE_UNAVAILABLE_MESSAGE =
  "The judge frog couldn't finish this step. You can try it again.";

/**
 * What a retry needs. The Polyvise API runs the debate and keeps its steps
 * for a while; the checkpoint saved here outlives the API's copy.
 */
type StoredDebateRecord = RecoverableDebateRecord & {
  retryState?: {
    request: DebateRequest;
    stepModels: DebateStepModelSelections;
    checkpoint?: RunCheckpoint;
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

/** An attempt this server instance is following on the API. */
interface RunWatch {
  bus: DebateEventBus;
  completion: Promise<DebateRecord>;
}

const watches = new Map<string, RunWatch>();

function scheduleWatchCleanup(id: string, watch: RunWatch, delayMs = 5 * 60 * 1000): void {
  setTimeout(() => {
    if (watches.get(id) === watch) watches.delete(id);
  }, delayMs).unref?.();
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

function optionsFor(record: StoredDebateRecord) {
  const { request, stepModels } = record.retryState!;
  return runOptions(stepModels, record.readingLevel, Boolean(request.devOptions?.liveApis));
}

export interface StartDebateResult {
  debate: DebateRecord;
  completion: Promise<DebateRecord>;
}

/**
 * Starts a debate on the Polyvise API and follows it from here.
 *
 * The API validates and frames the request and runs the engine as a
 * background job; this app owns the record. Throws `ZodError` or an
 * `invalidRequest` `PolyviseApiError` when the request is malformed.
 */
export async function startDebate(input: DebatefrogRequest): Promise<StartDebateResult> {
  const parsed = debatefrogRequestSchema.parse(input) as DebatefrogRequest;
  const { record, request } = await seedRecord(toCoreDebateRequest(parsed));
  const stored: StoredDebateRecord = {
    ...record,
    readingLevel: parsed.readingLevel ?? DEFAULT_READING_LEVEL,
    retryState: {
      request,
      stepModels: resolveDebateStepModels(stepModelsFromRequest(parsed.models), resolveDebateStepModelDefaults()),
      events: [],
      attempt: 0
    }
  };
  await startJob(stored.id, request, optionsFor(stored));
  await repository.save(stored);
  return { debate: publicDebate(stored), completion: watchRun(stored).completion };
}

function nextUpdatedAt(previous: string): string {
  return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
}

function isSettled(status: DebateRecord["status"]): boolean {
  return status === "complete" || status === "failed" || status === "partial";
}

async function findJob(id: string): Promise<JobStatus | null> {
  try {
    return await getJob(id);
  } catch (error) {
    if (error instanceof PolyviseApiError && error.notFound) return null;
    throw error;
  }
}

/** Puts the API back to work on a debate, reusing whatever it or this app saved. */
async function relaunch(record: StoredDebateRecord): Promise<void> {
  const job = await findJob(record.id);
  // Still running, or finished after this app stopped following it: just follow.
  if (job?.status === "running" || job?.status === "complete") return;
  if (job?.resumable) {
    await resumeJob(record.id, job.attempt);
    return;
  }
  // The API no longer holds the job (it restarted, or the job expired).
  const { request, checkpoint } = record.retryState!;
  await startJob(record.id, request, { ...optionsFor(record), checkpoint });
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
  try {
    await relaunch(resumed);
  } catch (error) {
    // Hand the attempt back so the same retry can be made again.
    await repository.saveIfUnchanged(
      { ...record, status: "failed", updatedAt: nextUpdatedAt(resumed.updatedAt) },
      resumed.updatedAt
    );
    throw error;
  }
  watchRun(resumed);
  return { debate: publicDebate(resumed), accepted: true };
}

function watchRun(record: StoredDebateRecord): RunWatch {
  const attempt = record.retryState!.attempt;
  const existing = watches.get(record.id);
  if (existing?.bus.attempt === attempt) return existing;

  const bus = new DebateEventBus(attempt);
  const watch: RunWatch = { bus, completion: followRun(record, bus) };
  // Prevent unhandled rejection warnings when callers only consume via SSE.
  watch.completion.catch(() => {}).finally(() => scheduleWatchCleanup(record.id, watch));
  watches.set(record.id, watch);
  return watch;
}

const MAX_STREAM_FAILURES = 5;
/** Longer than the API's keep-alive interval, so a quiet but healthy stream is not mistaken for a broken one. */
const HEALTHY_STREAM_MS = 20_000;
const REPLACED_MESSAGE = "This debate attempt was replaced by another request.";
const INTERRUPTED: JobFailure = {
  message: "The Polyvise API no longer has this run.",
  summary: "The run was interrupted before it finished.",
  step: "run"
};

function isLiveEvent(data: unknown): data is DebateLiveEvent {
  return Boolean(data) && typeof data === "object" && typeof (data as { kind?: unknown }).kind === "string";
}

/**
 * Relays one attempt's events from the API onto the bus, saving progress as
 * it goes, then stores the outcome. A dropped connection resumes after the
 * last event received.
 */
async function followRun(seed: StoredDebateRecord, bus: DebateEventBus): Promise<DebateRecord> {
  let record = seed;
  let stage: DebateRecord["status"] = record.status;

  // False when another instance following the same attempt saved first; its
  // record becomes the base for the next save.
  const persist = async (
    status: DebateRecord["status"],
    latestRun: DebateRun | undefined,
    checkpoint: RunCheckpoint | undefined
  ): Promise<boolean> => {
    const next: StoredDebateRecord = {
      ...record, status, latestRun, updatedAt: nextUpdatedAt(record.updatedAt),
      retryState: { ...record.retryState!, checkpoint, events: [...bus.buffer] }
    };
    if (await repository.saveIfUnchanged(next, record.updatedAt)) {
      record = next;
      return true;
    }
    const current = await repository.get(record.id) as StoredDebateRecord | null;
    if (current?.retryState?.attempt !== bus.attempt) throw new Error(REPLACED_MESSAGE);
    record = current;
    return false;
  };

  const savedCheckpoint = async () =>
    (await getJobCheckpoint(record.id).catch(() => undefined)) ?? record.retryState!.checkpoint;

  const settle = async (status: DebateRecord["status"], latestRun: DebateRun | undefined) => {
    const checkpoint = await savedCheckpoint();
    for (let tries = 0; tries < 3; tries++) {
      if (await persist(status, latestRun, checkpoint)) return;
      if (isSettled(record.status)) return; // another instance stored the outcome
    }
    throw new Error("The debate result could not be saved.");
  };

  const fail = async (failure: JobFailure): Promise<never> => {
    console.error("[debatefrog.run.failed]", {
      debateId: record.id,
      step: failure.step,
      model: failure.model,
      attempts: failure.snapshot?.attempts?.length,
      reason: failure.summary,
      message: failure.message.replace(/sk-or-v1-[a-zA-Z0-9_-]+/g, "[redacted-api-key]").slice(0, 1000)
    });
    try {
      await settle("failed", record.latestRun);
    } finally {
      bus.emit({ kind: "error", message: stage === "judging" ? DEBATE_JUDGE_UNAVAILABLE_MESSAGE : DEBATE_UNAVAILABLE_MESSAGE });
    }
    throw new Error(failure.message);
  };

  let lastEventId: string | undefined;
  let failures = 0;

  try {
    for (;;) {
      const connectedAt = Date.now();
      let progressed = false;
      let ended = false;
      let lost = false;
      try {
        for await (const event of jobEvents(record.id, lastEventId)) {
          progressed = true;
          if (event.id) lastEventId = event.id;
          // The outcome is published below, once it is stored, so a client that
          // stops listening at `complete` can already fetch the finished debate.
          if (event.name === "closed" || event.name === "complete" || event.name === "error") {
            ended = true;
            break;
          }
          if (!isLiveEvent(event.data)) continue;
          const live = event.data;
          if (live.kind === "stage") {
            if (live.status === "complete") continue;
            stage = live.status;
          }
          bus.emit(live);
          if (live.kind === "stage" || live.kind === "turns") {
            await persist(stage, record.latestRun, await savedCheckpoint());
          }
        }
      } catch (error) {
        if (error instanceof Error && error.message === REPLACED_MESSAGE) throw error;
        lost = error instanceof PolyviseApiError && error.notFound;
        if (!lost) {
          console.warn("[debatefrog.run.stream]", {
            debateId: record.id,
            reason: error instanceof Error ? error.message.slice(0, 300) : "Unknown error"
          });
        }
      }

      if (lost) return await fail(INTERRUPTED);
      if (ended) {
        const job = await findJob(record.id).catch(() => null);
        if (job?.status === "complete" && job.run) {
          await settle(job.run.status, job.run);
          bus.emit({ kind: "stage", status: "complete" });
          bus.emit({ kind: "complete", runId: job.run.id });
          return publicDebate(record);
        }
        if (job?.status !== "running") return await fail(job?.failure ?? INTERRUPTED);
      }
      failures = progressed || Date.now() - connectedAt >= HEALTHY_STREAM_MS ? 0 : failures + 1;
      if (failures >= MAX_STREAM_FAILURES) {
        return await fail({ ...INTERRUPTED, message: "Lost contact with the Polyvise API." });
      }
      if (failures > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(500 * 2 ** failures, 8000)));
      }
    }
  } catch (error) {
    // Anyone still listening to a replaced attempt must be released.
    if (!bus.isTerminal()) bus.emit({ kind: "error", message: DEBATE_UNAVAILABLE_MESSAGE });
    throw error;
  }
}

export async function createDebate(input: DebatefrogRequest): Promise<DebateRecord> {
  const { completion } = await startDebate(input);
  return completion;
}

/**
 * Streams an attempt's events to `listener`, replaying what already happened.
 *
 * An attempt that is still in flight but unknown to this server instance —
 * started by another instance, or before a restart — is picked up from the
 * API, which replays it and lets this instance store the outcome.
 */
export async function subscribeToDebate(
  debateId: string,
  listener: Listener,
  attempt?: number
): Promise<{ unsubscribe: () => void; terminal: boolean }> {
  let watch = watches.get(debateId);
  if (!watch || (attempt !== undefined && watch.bus.attempt !== attempt)) {
    const record = await repository.get(debateId) as StoredDebateRecord | null;
    if (
      !record?.retryState || isSettled(record.status) ||
      (attempt !== undefined && record.retryState.attempt !== attempt)
    ) {
      return { unsubscribe: () => {}, terminal: true };
    }
    watch = watchRun(record);
  }
  const unsubscribe = watch.bus.subscribe(listener);
  return { unsubscribe, terminal: watch.bus.isTerminal() };
}

export async function getDebate(id: string): Promise<RecoverableDebateRecord | null> {
  const record = await repository.get(id) as StoredDebateRecord | null;
  return record ? publicDebate(record) : null;
}

export function listDebates(): Promise<DebateRecord[]> {
  return repository.list();
}

/** Throws an `invalidRequest` `PolyviseApiError` when the feedback is malformed. */
export async function submitFeedback(input: {
  app?: string;
  message: string;
  debateId?: string;
  pagePath?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}): Promise<UserFeedback> {
  const feedback = await normalizeFeedback({ ...input, app: input.app?.trim() || "debatefrog" });
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

  const answer = await followupAnswer(question, debate);
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

async function followupAnswer(question: string, debate: StoredDebateRecord): Promise<string> {
  const fallbackAnswer = answerFollowupDeterministic(question, debate);

  try {
    const { answer } = await answerFollowup(
      {
        question,
        fallbackAnswer,
        context: {
          subject: debate.subject,
          summary: debate.latestRun?.summary,
          sources: debate.latestRun?.sources,
          turns: debate.latestRun?.turns
        }
      },
      {
        config: { useStrictJsonSchema: false },
        provider: providerOptions(resolveDebateStepModelDefaults(), debate.readingLevel)
      }
    );
    return answer;
  } catch {
    return fallbackAnswer;
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
