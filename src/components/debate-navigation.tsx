"use client";

import { useEffect, useRef } from "react";
import { ArrowRight, BookOpen, X } from "lucide-react";
import type { DebateHistoryEntry } from "@/lib/debate-history";

export function DebateHistory({ entries, currentId, loadingId, error, onOpen, onClose }: {
  entries: DebateHistoryEntry[];
  currentId?: string;
  loadingId: string | null;
  error: string | null;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <section id="debate-history" aria-labelledby="history-title" className="debate-history mt-6 rounded-2xl bg-panel p-5 text-ink sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="history-title" className="text-xl font-black text-pond">My debates</h2>
          <p className="mt-1 text-sm">Your last 50 questions from this browser. Pick one to open it again.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close my debates" className="history-close flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-pond hover:bg-mint">
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      {error ? <p role="alert" className="mt-4 text-sm font-semibold text-[#982f48]">{error}</p> : null}
      {entries.length ? (
        <ul className="mt-4 max-h-80 overflow-y-auto divide-y divide-pond/15">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button type="button" disabled={Boolean(loadingId)} onClick={() => onOpen(entry.id)}
                aria-current={entry.id === currentId ? "true" : undefined}
                className="flex min-h-16 w-full items-center gap-3 rounded-lg px-2 py-3 text-left hover:bg-mint disabled:opacity-60">
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-bold text-pond">{entry.subject}</span>
                  <span className="mt-1 block text-xs text-mud">
                    {new Date(entry.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    {" · "}{entry.id === currentId ? "Open now" : entry.status === "complete" ? "Finished" : entry.status === "failed" || entry.status === "partial" ? "Needs another try" : "Started · open to check"}
                  </span>
                </span>
                {loadingId === entry.id ? <span role="status" className="text-sm">Opening…</span> : <ArrowRight size={18} className="shrink-0 text-pond" aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex items-center gap-3 py-7">
          <BookOpen className="shrink-0 text-pond" aria-hidden="true" />
          <p>No debates here yet. Start a question and it will appear here.</p>
        </div>
      )}
      <p className="mt-4 text-xs leading-relaxed text-mud">Anyone using this browser can see this list. Clearing browser data clears the list. Debates from before this feature won’t appear here.</p>
    </section>
  );
}

export function LeaveDebateDialog({ destination, hasDebate, saved, onCancel, onConfirm }: {
  destination: "new" | "history" | "stats";
  hasDebate: boolean;
  saved: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current!;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <dialog ref={ref} aria-labelledby="leave-title" aria-describedby="leave-description" onCancel={onCancel}
      className="debate-leave-dialog w-[calc(100%_-_2rem)] max-w-md rounded-2xl bg-panel p-6 text-ink shadow-xl backdrop:bg-black/60">
      <h2 id="leave-title" className="text-xl font-black text-pond">{destination === "stats" ? "Visit Pond stats?" : destination === "history" ? "Open a different debate?" : "Start a new question?"}</h2>
      <p id="leave-description" className="mt-3 text-sm leading-relaxed">
        {hasDebate ? saved
          ? "You’ll leave this debate. Its saved progress is in My debates, so you can open it again."
          : "This browser couldn’t save this debate to My debates. If you leave, you won’t be able to find it there. Stay here to keep reading."
          : "The question you’ve typed hasn’t been started. If you leave, you’ll lose that draft."}
      </p>
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button type="button" autoFocus onClick={onCancel} className="min-h-11 rounded-full border border-pond/30 px-4 py-2 font-bold text-pond hover:bg-mint">No, stay here</button>
        <button type="button" onClick={onConfirm} className="min-h-11 rounded-full bg-pond px-4 py-2 font-bold text-cream hover:bg-[#176956]">{destination === "stats" ? "Yes, visit stats" : destination === "history" ? "Yes, open debate" : "Yes, new question"}</button>
      </div>
    </dialog>
  );
}
