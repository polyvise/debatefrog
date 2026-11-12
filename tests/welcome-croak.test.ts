import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WelcomeCroak } from "@/components/welcome-croak";

describe("welcome croak", () => {
  let container: HTMLDivElement;
  let root: Root;
  let play: ReturnType<typeof vi.spyOn>;
  let pause: ReturnType<typeof vi.spyOn>;
  const defaults = { enabled: true, muted: false, preferencesReady: true };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("probably");
    play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function render(props = defaults) {
    await act(async () => root.render(createElement(StrictMode, null, createElement(WelcomeCroak, props))));
    await act(async () => { vi.runOnlyPendingTimers(); });
  }

  it("plays one non-looping clip after render, even in Strict Mode or on re-render", async () => {
    await render();
    await render();
    const audio = container.querySelector("audio")!;
    expect(play).toHaveBeenCalledTimes(1);
    expect(audio.loop).toBe(false);
    expect(audio.src).toContain("/sounds/frog1.wav?v=");
    expect(audio.volume).toBe(0.18);
  });

  it("waits for the saved mute setting and does not play later when unmuted", async () => {
    await render({ ...defaults, preferencesReady: false });
    expect(play).not.toHaveBeenCalled();
    await render({ ...defaults, muted: true });
    await render();
    expect(play).not.toHaveBeenCalled();
  });

  it("uses the first gesture when autoplay is blocked, without duplicate croaks", async () => {
    play.mockRejectedValueOnce(new DOMException("Autoplay blocked", "NotAllowedError"));
    await render();
    await act(async () => {
      document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    });
    document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(play).toHaveBeenCalledTimes(2); // One denied attempt, one successful sound.
  });

  it("does not trigger a blocked croak when the user clicks mute", async () => {
    play.mockRejectedValueOnce(new DOMException("Autoplay blocked", "NotAllowedError"));
    await render();
    const button = document.createElement("button");
    button.dataset.audioToggle = "";
    container.appendChild(button);
    button.click();
    document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending croak when a debate starts and never repeats on New question", async () => {
    play.mockRejectedValueOnce(new DOMException("Autoplay blocked", "NotAllowedError"));
    await render();
    await render({ ...defaults, enabled: false });
    await render();
    document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(play).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalled();
  });

  it("stops playback when muted and does not replay when sound is turned back on", async () => {
    await render();
    pause.mockClear();
    await render({ ...defaults, muted: true });
    expect(pause).toHaveBeenCalledTimes(1);
    await render();
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("does not retry a failed or unsupported audio file on later clicks", async () => {
    play.mockRejectedValueOnce(new DOMException("Unavailable clip", "NotSupportedError"));
    await render();
    document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(play).toHaveBeenCalledTimes(1);
  });
});
