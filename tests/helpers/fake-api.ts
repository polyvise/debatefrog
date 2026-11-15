import { vi } from "vitest";
import recorded from "../fixtures/polyvise-api.json";

/**
 * A stand-in for the Polyvise API. It replays one debate recorded from the
 * real service in mock mode (scripts/record-api-fixtures.mjs) and keeps jobs
 * the way the service does, so tests can fail a step, resume, or lose a job.
 */

export const fixtures = recorded;
export const FAKE_API_URL = "http://polyvise-api.test";

export interface FakeApiCall {
  method: string;
  path: string;
  headers: Headers;
  body: any;
}

interface FakeJob {
  attempt: number;
  status: "complete" | "failed";
  blocks: string[];
}

export interface FakeApi {
  calls: FakeApiCall[];
  /** End the next attempt with a failure just before its first event of this kind. */
  failBefore: string | null;
  /** Answers for other endpoints, keyed by path. A function receives the request body. */
  routes: Record<string, unknown | ((body: any) => unknown)>;
  /** Forget every job, as an API restart would. */
  loseJobs(): void;
  /** A job the app did not start from this process (another instance did). */
  addJob(id: string): void;
  posts(path: string): FakeApiCall[];
}

const FAILURE = {
  message: "Model timed out",
  summary: "openai/gpt-4.1 timed out during final summary. Try a faster model or try again later.",
  step: "final summary",
  model: "openai/gpt-4.1"
};

/** The recorded run under another debate id, as text so every nested id follows. */
function forDebate<T>(value: T, id: string): T {
  return JSON.parse(JSON.stringify(value).replaceAll(recorded.record.id, id)) as T;
}

function attemptBlocks(id: string, attempt: number, failBefore: string | null): { blocks: string[]; failed: boolean } {
  const events = forDebate(recorded.events, id)
    .split("\n\n")
    .filter((block) => block && !block.startsWith("event: closed"))
    .map((block) => block.split("\n").filter((line) => !line.startsWith("id: ")).join("\n"));
  const cut = failBefore ? events.findIndex((block) => block.startsWith(`event: ${failBefore}\n`)) : -1;
  const kept = cut === -1 ? events : [
    ...events.slice(0, cut),
    `event: error\ndata: ${JSON.stringify({ kind: "error", message: FAILURE.summary })}`
  ];
  return {
    blocks: [...kept.map((block, index) => `id: ${attempt}:${index + 1}\n${block}\n\n`), "event: closed\ndata: {}\n\n"],
    failed: cut !== -1
  };
}

function stream(blocks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      // Split mid-event, with a keep-alive comment, the way a real connection delivers them.
      const text = `: ping\n\n${blocks.join("")}`;
      const middle = Math.floor(text.length / 2) + 3;
      controller.enqueue(encoder.encode(text.slice(0, middle)));
      controller.enqueue(encoder.encode(text.slice(middle)));
      controller.close();
    }
  });
}

/** Ids stay unique across installs, as they are across real runs. */
let seeded = 0;

/** Replaces `fetch` with the fake API. */
export function installFakeApi(): FakeApi {
  vi.stubEnv("POLYVISE_API_URL", FAKE_API_URL);
  const jobs = new Map<string, FakeJob>();
  const json = (body: unknown, status = 200) => Response.json(body, { status });

  const launch = (id: string, attempt: number) => {
    const { blocks, failed } = attemptBlocks(id, attempt, api.failBefore);
    jobs.set(id, { attempt, status: failed ? "failed" : "complete", blocks });
  };

  const api: FakeApi = {
    calls: [],
    failBefore: null,
    routes: {},
    loseJobs: () => jobs.clear(),
    addJob: (id) => launch(id, 0),
    posts: (path) => api.calls.filter((call) => call.method === "POST" && call.path === path)
  };

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (!url.startsWith(FAKE_API_URL)) {
        throw new Error(`Unexpected request outside the fake Polyvise API: ${url}`);
      }
      const path = url.slice(FAKE_API_URL.length).split("?")[0];
      const method = init.method ?? "GET";
      const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      const headers = new Headers(init.headers);
      api.calls.push({ method, path, headers, body });

      if (path in api.routes) {
        const route = api.routes[path];
        const answer = typeof route === "function" ? route(body) : route;
        return answer instanceof Response ? answer : json(answer);
      }

      if (path === "/v1/config") return json(recorded.runtime);
      if (path === "/v1/model-options") return json({ options: recorded.modelOptions });
      if (path === "/v1/followups") return json({ answer: "The green frog had the stronger reason.", generated: true });
      if (path === "/v1/feedback") {
        if (!String(body?.message ?? "").trim()) {
          return json({ error: "Invalid request.", issues: [{ path: ["message"], message: "Feedback cannot be empty." }] }, 422);
        }
        return json({
          feedback: { id: "feedback_test", app: body.app, message: body.message, metadata: body.metadata ?? {}, createdAt: new Date().toISOString() }
        });
      }

      if (path === "/v1/records") {
        if (String(body?.subject ?? "").trim().length < 4) {
          return json({ error: "Invalid request.", issues: [{ path: ["subject"], message: "Enter at least a short subject." }] }, 422);
        }
        const id = `debate_test${++seeded}`;
        return json({
          record: { ...forDebate(recorded.record, id), subject: body.subject },
          request: { ...recorded.request, ...body }
        });
      }

      if (path === "/v1/jobs") {
        launch(body.debateId, 0);
        return json({ debateId: body.debateId, attempt: 0, status: "running", framed: recorded.job.framed }, 202);
      }

      const match = /^\/v1\/jobs\/([^/]+)(\/events|\/checkpoint|\/resume)?$/.exec(path);
      const job = match ? jobs.get(match[1]) : undefined;
      if (!match || !job) return json({ error: "Run not found." }, 404);
      const [, id, action] = match;

      if (action === "/events") {
        const after = Number((headers.get("last-event-id") ?? "0:0").split(":")[1]);
        return new Response(stream(job.blocks.slice(after)), { headers: { "Content-Type": "text/event-stream" } });
      }
      if (action === "/checkpoint") return json({ checkpoint: forDebate(recorded.checkpoint, id) });
      if (action === "/resume") {
        if (job.status === "complete") return json({ error: "This run already completed." }, 409);
        if (body.attempt !== job.attempt) return json({ error: "That attempt has ended." }, 409);
        launch(id, job.attempt + 1);
        return json({ debateId: id, attempt: job.attempt + 1, status: "running", framed: recorded.job.framed }, 202);
      }
      return json(
        job.status === "complete"
          ? { ...forDebate(recorded.job, id), attempt: job.attempt }
          : { ...forDebate(recorded.job, id), attempt: job.attempt, status: "failed", run: undefined, failure: FAILURE, resumable: true }
      );
    })
  );
  return api;
}
