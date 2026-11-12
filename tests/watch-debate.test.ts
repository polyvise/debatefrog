import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DebateRecord } from "@polyvise/core/debate/types";
import { DEBATE_IDLE_TIMEOUT_MS, watchDebate } from "@/lib/watch-debate";

class FakeEventSource extends EventTarget {
  static current: FakeEventSource;
  close = vi.fn();
  constructor() {
    super();
    FakeEventSource.current = this;
  }
  send(kind: string, data: unknown = { kind }) {
    this.dispatchEvent(new MessageEvent(kind, { data: JSON.stringify(data) }));
  }
}

const record = (status: DebateRecord["status"]) => ({ id: "test", status });
const response = (status: DebateRecord["status"]) => new Response(JSON.stringify({ debate: record(status) }));

describe("debate stream recovery", () => {
  let stop: (() => void) | undefined;
  const onEvent = vi.fn();
  const onRecord = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    onEvent.mockReset();
    onRecord.mockReset();
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    stop?.();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("recovers a saved result after the server closes a stream on another instance", async () => {
    const fetch = vi.fn().mockResolvedValue(response("complete"));
    vi.stubGlobal("fetch", fetch);
    stop = watchDebate("test", onEvent, onRecord);
    FakeEventSource.current.send("closed");
    await vi.advanceTimersByTimeAsync(0);
    expect(onRecord).toHaveBeenCalledWith(record("complete"));
    expect(FakeEventSource.current.close).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps polling when completion arrives before the result is saved", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response("queued"))
      .mockResolvedValueOnce(response("complete"));
    vi.stubGlobal("fetch", fetch);
    stop = watchDebate("test", onEvent, onRecord);
    FakeEventSource.current.send("complete", { kind: "complete", runId: "run" });
    await vi.advanceTimersByTimeAsync(0);
    expect(onRecord).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onRecord).toHaveBeenCalledWith(record("complete"));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers a failed record after a transport error without a structured error event", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("failed")));
    stop = watchDebate("test", onEvent, onRecord);
    FakeEventSource.current.dispatchEvent(new Event("error"));
    await vi.advanceTimersByTimeAsync(0);
    expect(onEvent).not.toHaveBeenCalled();
    expect(onRecord).toHaveBeenCalledWith(record("failed"));
  });

  it("recovers a missing terminal event even if the stream stays open", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("complete")));
    stop = watchDebate("test", onEvent, onRecord);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onRecord).toHaveBeenCalledWith(record("complete"));
  });

  it("shows a bounded failure if the worker never saves a result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response("queued")));
    stop = watchDebate("test", onEvent, onRecord);
    await vi.advanceTimersByTimeAsync(DEBATE_IDLE_TIMEOUT_MS);
    expect(onRecord).not.toHaveBeenCalled();
    expect(onEvent).toHaveBeenCalledWith({ kind: "error", message: expect.stringContaining("lost touch") });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts stuck reads and still reaches the idle deadline", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    })));
    stop = watchDebate("test", onEvent, onRecord);
    await vi.advanceTimersByTimeAsync(DEBATE_IDLE_TIMEOUT_MS);
    expect(onEvent).toHaveBeenCalledWith({ kind: "error", message: expect.stringContaining("lost touch") });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not replace a streamed success with a later network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    stop = watchDebate("test", onEvent, onRecord);
    FakeEventSource.current.send("complete", { kind: "complete", runId: "run" });
    await vi.advanceTimersByTimeAsync(DEBATE_IDLE_TIMEOUT_MS);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ kind: "complete", runId: "run" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores an in-flight result after the user starts another debate", async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((done) => { resolve = done; })));
    stop = watchDebate("test", onEvent, onRecord);
    FakeEventSource.current.send("closed");
    stop();
    resolve(response("complete"));
    await vi.advanceTimersByTimeAsync(0);
    FakeEventSource.current.send("stage", { kind: "stage", status: "judging" });
    expect(onRecord).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows a structured failure immediately and stops polling", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    stop = watchDebate("test", onEvent, onRecord);
    FakeEventSource.current.send("error", { kind: "error", message: "The judge couldn't finish." });
    expect(onEvent).toHaveBeenCalledWith({ kind: "error", message: "The judge couldn't finish." });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
