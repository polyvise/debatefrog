"use client";

import { useEffect, useRef } from "react";
import { judgeCueOptions, type useFrogSounds } from "@/components/use-frog-sounds";

/** The judge greets the viewer once when a new debate takes the stage. */
export function useJudgeEntranceCroak(
  debateId: string | undefined,
  { ready, muted, play, stop }: Pick<ReturnType<typeof useFrogSounds>, "ready" | "muted" | "play" | "stop">
) {
  const playedDebate = useRef<string | null>(null);

  useEffect(() => {
    if (!debateId || playedDebate.current === debateId) return;
    if (muted) {
      playedDebate.current = debateId;
      return;
    }
    if (!ready) return;
    const timer = window.setTimeout(() => {
      playedDebate.current = debateId;
      play("judge", judgeCueOptions);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [debateId, ready, muted, play]);

  useEffect(() => () => { if (debateId) stop("judge"); }, [debateId, stop]);
}
