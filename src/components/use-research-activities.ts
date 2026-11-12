"use client";

import { useEffect, useState } from "react";

export type ResearchActivity = "search" | "notes";
export const researchActivityLabel = (activity: ResearchActivity) =>
  activity === "search" ? "Checking sources" : "Taking notes";

/** Keep the pair in sync, and pause their routine in a hidden tab. */
export function useResearchActivities(active: boolean) {
  const [swapped, setSwapped] = useState(false);
  useEffect(() => {
    setSwapped(false);
    if (!active) return;
    let timer: number | undefined;
    const schedule = () => {
      window.clearInterval(timer);
      if (!document.hidden) timer = window.setInterval(() => setSwapped(value => !value), 4000);
    };
    schedule();
    document.addEventListener("visibilitychange", schedule);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [active]);
  return {
    pro: swapped ? "notes" : "search",
    con: swapped ? "search" : "notes"
  } as const;
}
