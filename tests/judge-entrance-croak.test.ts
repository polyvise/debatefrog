import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useJudgeEntranceCroak } from "@/components/use-judge-entrance-croak";

describe("judge entrance croak", () => {
  let container: HTMLDivElement;
  let root: Root;
  const play = vi.fn();
  const stop = vi.fn();
  function Harness({ id, ready = true, muted = false }: { id?: string; ready?: boolean; muted?: boolean }) {
    useJudgeEntranceCroak(id, { ready, muted, play, stop });
    return null;
  }
  function render(props: Parameters<typeof Harness>[0]) {
    act(() => root.render(createElement(StrictMode, null, createElement(Harness, props))));
    act(() => vi.advanceTimersByTime(0));
  }
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    play.mockClear(); stop.mockClear();
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers(); vi.unstubAllGlobals();
  });
  it("stays silent on the opening page and waits for audio readiness", () => {
    render({});
    render({ id: "first", ready: false });
    expect(play).not.toHaveBeenCalled();
    render({ id: "first" });
    expect(play).toHaveBeenCalledExactlyOnceWith("judge", { once: true });
  });
  it("plays once in Strict Mode and on each new debate, without repeating on rerender", () => {
    render({ id: "first" });
    render({ id: "first" });
    expect(play).toHaveBeenCalledTimes(1);
    render({ id: "second" });
    expect(play).toHaveBeenCalledTimes(2);
  });
  it("skips a muted entrance without replaying it later", () => {
    render({ id: "first", muted: true });
    render({ id: "first" });
    expect(play).not.toHaveBeenCalled();
    render({ id: "second" });
    expect(play).toHaveBeenCalledTimes(1);
  });
  it("cancels an entrance when the stage is removed before playback", () => {
    act(() => root.render(createElement(Harness, { id: "first" })));
    act(() => root.render(null));
    act(() => vi.runAllTimers());
    expect(play).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledWith("judge");
  });
});
