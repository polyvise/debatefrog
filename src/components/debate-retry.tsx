"use client";

import { Loader2, RotateCcw } from "lucide-react";

export type DebateRetryProps = {
  onRetry?: () => void;
  retrying?: boolean;
  retryError?: string | null;
};

export function DebateRetry({ onRetry, retrying, retryError }: DebateRetryProps) {
  if (!onRetry) return null;
  return (
    <div className="mt-3 space-y-2 text-base">
      <p className="text-sm">Pick up where the frogs stopped.</p>
      <button type="button" onClick={onRetry} disabled={retrying} aria-busy={retrying}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-sun px-5 py-2 font-bold text-pond transition hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pond focus-visible:ring-offset-2 focus-visible:ring-offset-cream disabled:cursor-wait disabled:opacity-60">
        {retrying ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <RotateCcw aria-hidden="true" className="h-4 w-4" />}
        {retrying ? "Reconnecting…" : "Try this step again"}
      </button>
      {retryError ? <p role="alert" className="text-sm">{retryError}</p> : null}
    </div>
  );
}
