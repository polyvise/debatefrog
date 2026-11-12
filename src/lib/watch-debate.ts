import type { DebateLiveEvent, DebateRecord } from "@polyvise/core/debate/types";

const POLL_INTERVAL_MS = 10_000;
const REQUEST_TIMEOUT_MS = 10_000;
export const DEBATE_IDLE_TIMEOUT_MS = 5 * 60_000;
export const DEBATE_CONNECTION_MESSAGE =
  "We lost touch with the frogs before they could finish. Choose New question to try again.";

/** SSE supplies live turns; the saved record recovers a missed terminal event. */
export function watchDebate(
  debateId: string,
  onEvent: (event: DebateLiveEvent) => void,
  onRecord: (debate: DebateRecord) => void
): () => void {
  const stream = new EventSource(`/api/debates/${debateId}/events`);
  let stopped = false;
  let pending = false;
  let lastProgressAt = Date.now();
  let receivedCompletion = false;
  let request: AbortController | null = null;

  const stop = () => {
    stopped = true;
    stream.close();
    clearInterval(timer);
    request?.abort();
  };

  const poll = async () => {
    if (stopped || pending) return;
    pending = true;
    const controller = new AbortController();
    request = controller;
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`/api/debates/${debateId}`, {
        cache: "no-store", signal: controller.signal
      });
      if (!response.ok) return;
      const { debate } = await response.json() as { debate?: DebateRecord };
      if (stopped || !debate || debate.id !== debateId) return;
      if (["complete", "failed", "partial"].includes(debate.status)) {
        onRecord(debate);
        stop();
      }
      // A queued record is normal until the worker saves its result. Never
      // replace streamed turns or a completed UI with this older snapshot.
    } catch {
      // Temporary network failures are retried until the idle deadline.
    } finally {
      clearTimeout(timeout);
      request = null;
      pending = false;
    }
  };

  const timer = setInterval(() => {
    if (Date.now() - lastProgressAt >= DEBATE_IDLE_TIMEOUT_MS) {
      if (!receivedCompletion) onEvent({ kind: "error", message: DEBATE_CONNECTION_MESSAGE });
      stop();
      return;
    }
    void poll();
  }, POLL_INTERVAL_MS);

  const kinds: DebateLiveEvent["kind"][] = [
    "stage", "framed", "scouts", "teams", "sources", "claims",
    "argument_map", "turns", "scorecard", "summary", "model_snapshot", "complete", "error"
  ];
  for (const kind of kinds) {
    stream.addEventListener(kind, (message) => {
      if (stopped) return;
      // EventSource's transport errors have no data. Close the stream to
      // avoid replaying all turns on reconnect; polling still gets the result.
      if (!(message instanceof MessageEvent)) {
        stream.close();
        void poll();
        return;
      }
      let event: DebateLiveEvent;
      try {
        event = JSON.parse(message.data) as DebateLiveEvent;
      } catch {
        return;
      }
      if (event.kind !== kind) return;
      lastProgressAt = Date.now();
      onEvent(event);
      if (event.kind === "error") stop();
      if (event.kind === "complete") {
        receivedCompletion = true;
        stream.close();
        // The engine emits completion just before persistence. Keep polling
        // if this first fetch races the save.
        void poll();
      }
    });
  }
  stream.addEventListener("closed", () => {
    if (stopped) return;
    stream.close();
    void poll();
  });

  return stop;
}
