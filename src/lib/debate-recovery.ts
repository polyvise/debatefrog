import type { ReadingLevel } from "@/lib/reading-level";
import type { DebateLiveEvent, DebateRecord } from "@polyvise/core/debate/types";

export type RecoverableDebateRecord = DebateRecord & {
  readingLevel?: ReadingLevel;
  recovery?: { attempt: number; available: boolean };
  liveEvents?: DebateLiveEvent[];
};
