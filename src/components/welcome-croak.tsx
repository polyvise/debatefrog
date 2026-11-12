"use client";

import { useEffect, useRef } from "react";
import { audioClips } from "@/lib/audio-manifest";
import { pickSourceUrl } from "@/components/use-frog-sounds";

/** One welcome sound per page visit, independent of the debate's looping audio. */
export function WelcomeCroak({ enabled, muted, preferencesReady }: {
  enabled: boolean;
  muted: boolean;
  preferencesReady: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const finished = useRef(false);

  useEffect(() => {
    if (!preferencesReady || finished.current) return;
    if (!enabled || muted) {
      finished.current = true;
      return;
    }
    const element = audioRef.current;
    const source = audioClips.map(pickSourceUrl).find((url) => url !== null);
    if (!element || !source) return;
    const audio = element;
    audio.src = source;
    audio.volume = 0.18;

    let disposed = false;
    let inFlight = false;
    let blocked = false;
    const removeListeners = () => {
      document.removeEventListener("click", onGesture);
      document.removeEventListener("keydown", onGesture);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    const attempt = () => {
      if (disposed || inFlight || finished.current || document.hidden) return;
      inFlight = true;
      void audio.play().then(() => {
        if (disposed) {
          audio.pause();
          return;
        }
        finished.current = true;
        document.removeEventListener("click", onGesture);
        document.removeEventListener("keydown", onGesture);
      }).catch((error: unknown) => {
        if (disposed) return;
        inFlight = false;
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          blocked = true;
        } else {
          finished.current = true;
          removeListeners();
        }
      });
    };
    function onGesture(event: Event) {
      // Clicking mute should never itself trigger the welcome sound.
      if (event.target instanceof Element && event.target.closest("[data-audio-toggle]")) {
        finished.current = true;
        audio.pause();
        removeListeners();
        return;
      }
      if (blocked) attempt();
    }
    function onVisibilityChange() {
      if (document.hidden) {
        finished.current = true;
        audio.pause();
        removeListeners();
      } else {
        attempt();
      }
    }

    document.addEventListener("click", onGesture);
    document.addEventListener("keydown", onGesture);
    document.addEventListener("visibilitychange", onVisibilityChange);
    // Defer one task so Strict Mode's setup/cleanup check cannot croak twice.
    const timer = window.setTimeout(attempt, 0);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      removeListeners();
      audio.pause();
    };
  }, [enabled, muted, preferencesReady]);

  return <audio ref={audioRef} preload="auto" loop={false} hidden aria-hidden="true" data-welcome-croak />;
}
