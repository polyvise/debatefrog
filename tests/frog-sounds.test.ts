import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { judgeCueOptions, useFrogSounds } from "@/components/use-frog-sounds";

function param() {
  return { value: 0, cancelScheduledValues: vi.fn(), linearRampToValueAtTime: vi.fn(), setValueAtTime: vi.fn() };
}
function node() {
  return { gain: param(), frequency: param(), playbackRate: param(), connect: vi.fn(function (this: unknown) { return this; }), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null, loop: false, buffer: null as unknown };
}

describe("frog audio playback", () => {
  let root: Root;
  let api: ReturnType<typeof useFrogSounds>;
  let context: MockContext;
  class MockContext {
    state = "suspended";
    currentTime = 0;
    destination = {};
    sources: ReturnType<typeof node>[] = [];
    oscillators: ReturnType<typeof node>[] = [];
    constructor() { context = this; }
    resume = vi.fn(async () => { this.state = "running"; });
    close = vi.fn(async () => { this.state = "closed"; });
    gains: ReturnType<typeof node>[] = [];
    createGain = () => { const gain = node(); this.gains.push(gain); return gain; };
    createBufferSource = () => { const source = node(); this.sources.push(source); return source; };
    createOscillator = () => { const source = node(); this.oscillators.push(source); return source; };
    decodeAudioData = vi.fn(async () => ({ duration: 0.86 }));
  }
  function Harness() { api = useFrogSounds(); return null; }
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("AudioContext", MockContext);
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("probably");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
    localStorage.clear();
    root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Harness)));
  });
  afterEach(() => { act(() => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("unlocks before fetching finishes and plays an entrance clip exactly once", async () => {
    let unlock!: Promise<void>;
    act(() => { unlock = api.unlock(); });
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(api.ready).toBe(false);
    await act(async () => { await unlock; });
    expect(api.ready).toBe(true);
    act(() => api.play("judge", judgeCueOptions));
    const entrance = context.sources[0];
    expect(entrance.loop).toBe(false);
    const [gain, fadeIn] = context.gains[3].gain.linearRampToValueAtTime.mock.calls.at(-1)!;
    expect(gain).toBeCloseTo(0.08);
    expect(fadeIn).toBe(0.2);
    expect(entrance.start).toHaveBeenCalledTimes(1);
    entrance.onended?.();
    expect(entrance.disconnect).toHaveBeenCalledTimes(1);
    act(() => api.play("pro"));
    expect(context.sources[1].loop).toBe(true);
    expect(context.gains[1].gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0.18, 0.12);
  });
  it("respects mute for the entrance", async () => {
    await act(async () => { await api.unlock(); });
    act(() => api.toggleMute());
    act(() => api.play("judge", judgeCueOptions));
    expect(context.sources).toHaveLength(0);
  });
  it("stops the fallback croak automatically and cleans up its modulation", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    await act(async () => { await api.unlock(); });
    act(() => api.play("judge", judgeCueOptions));
    expect(context.oscillators[0].stop).toHaveBeenCalledWith(0.5);
    expect(context.gains[5].gain.value).toBeCloseTo(0.22);
    context.oscillators[0].onended?.();
    expect(context.oscillators[1].stop).toHaveBeenCalled();
    expect(context.oscillators[2].stop).toHaveBeenCalled();
  });
});
