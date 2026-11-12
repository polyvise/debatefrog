import type { DebateLiveEvent, DebateRecord } from "@polyvise/core/debate/types";

export type RecoverableDebateRecord = DebateRecord & {
  recovery?: { attempt: number; available: boolean };
  liveEvents?: DebateLiveEvent[];
};
