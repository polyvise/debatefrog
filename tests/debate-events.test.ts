import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DebateLiveEvent } from "@polyvise/core/debate/types";

const store = vi.hoisted(() => ({ getDebate: vi.fn(), subscribeToDebate: vi.fn() }));
vi.mock("@/server/debate-store", () => store);
import { GET } from "@/app/api/debates/[id]/events/route";

describe("debate event stream cleanup", () => {
  let listener: (event: DebateLiveEvent) => void;
  const unsubscribe = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    unsubscribe.mockReset();
    store.getDebate.mockResolvedValue({ id: "test" });
    store.subscribeToDebate.mockImplementation((_id, callback) => {
      listener = callback;
      return { unsubscribe, terminal: false };
    });
  });

  afterEach(() => vi.useRealTimers());

  it("subscribes only to the requested retry attempt", async () => {
    const abort = new AbortController();
    const response = await GET(new Request("http://localhost/events?attempt=2", { signal: abort.signal }), { params: { id: "test" } });
    expect(store.subscribeToDebate).toHaveBeenLastCalledWith("test", expect.any(Function), 2);
    abort.abort();
    await response.text();
  });

  it.each([
    { kind: "complete", runId: "run" },
    { kind: "error", message: "The judge couldn't finish." }
  ] satisfies DebateLiveEvent[])("delivers $kind and releases heartbeat and subscription", async (event) => {
    const response = await GET(new Request("http://localhost/events"), { params: { id: "test" } });
    expect(vi.getTimerCount()).toBe(1);
    const body = response.text();
    listener(event);
    expect(await body).toContain(`event: ${event.kind}`);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up when the browser aborts", async () => {
    const abort = new AbortController();
    const response = await GET(new Request("http://localhost/events", { signal: abort.signal }), { params: { id: "test" } });
    abort.abort();
    expect(await response.text()).toBe("");
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases a subscription even when a terminal event is replayed synchronously", async () => {
    store.subscribeToDebate.mockImplementation((_id, callback) => {
      callback({ kind: "complete", runId: "run" });
      return { unsubscribe, terminal: true };
    });
    const response = await GET(new Request("http://localhost/events"), { params: { id: "test" } });
    expect(await response.text()).toContain("event: complete");
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
