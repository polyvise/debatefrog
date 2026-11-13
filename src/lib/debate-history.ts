import { debateStatuses, type DebateRecord } from "@polyvise/core/debate/types";

const HISTORY_KEY = "debatefrog:history:v1";
const HISTORY_LIMIT = 50;
export type DebateHistoryEntry = Pick<DebateRecord, "id" | "subject" | "createdAt" | "status">;

// This browser owns the list; never populate it from everyone's server records.
export function readDebateHistory(): DebateHistoryEntry[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.filter((entry): entry is DebateHistoryEntry => {
      if (!entry || typeof entry !== "object" || typeof entry.id !== "string" ||
        !/^debate_[a-zA-Z0-9_-]+$/.test(entry.id) || typeof entry.subject !== "string" ||
        !entry.subject.trim() || typeof entry.createdAt !== "string" ||
        !Number.isFinite(Date.parse(entry.createdAt)) || !debateStatuses.includes(entry.status) || seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    }).slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function rememberDebate(entry: DebateHistoryEntry): boolean {
  try {
    const entries = readDebateHistory();
    const previous = entries.find((item) => item.id === entry.id);
    const next = { id: entry.id, subject: entry.subject, createdAt: previous?.createdAt ?? entry.createdAt, status: entry.status };
    // Status updates keep creation order, even while an older debate is open.
    const history = [next, ...entries.filter((item) => item.id !== entry.id)]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, HISTORY_LIMIT);
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    return true;
  } catch {
    return false;
  }
}
