import {
  debateStatuses,
  type DebateRecord,
  type DebateStatus,
  type UserFeedback
} from "@polyvise/core/debate/types";
import {
  createDefaultDebateRepository,
  createDefaultFeedbackRepository
} from "./repository";

export interface PublicStats {
  totalDebates: number;
  completedDebates: number;
  completionRate: number;
  activeDebates: number;
  recent7Days: number;
  recent30Days: number;
  totalSources: number;
  totalTurns: number;
  totalFollowups: number;
  feedbackCount: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  statusBreakdown: Array<{ status: DebateStatus; count: number }>;
  dailyActivity: Array<{ date: string; label: string; count: number }>;
  modelUsage: Array<{ model: string; debates: number }>;
  lastUpdatedAt: string | null;
}

export async function getPublicStats(): Promise<PublicStats> {
  const [debates, feedback] = await Promise.all([
    createDefaultDebateRepository().listAll(),
    createDefaultFeedbackRepository().listAll()
  ]);

  return summarizePublicStats(debates, feedback);
}

export function summarizePublicStats(
  debates: DebateRecord[],
  feedback: UserFeedback[],
  now = new Date()
): PublicStats {
  const statusCounts = new Map<DebateStatus, number>(
    debateStatuses.map((status) => [status, 0])
  );
  const modelCounts = new Map<string, number>();
  const dayCounts = new Map<string, number>();
  const sevenDaysAgo = startOfUtcDay(now, 6);
  const thirtyDaysAgo = startOfUtcDay(now, 29);
  let totalSources = 0;
  let totalTurns = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let estimatedCostUsd = 0;
  let lastUpdatedAt: string | null = null;

  for (const debate of debates) {
    statusCounts.set(debate.status, (statusCounts.get(debate.status) ?? 0) + 1);
    const createdAt = parseDate(debate.createdAt);
    if (createdAt) {
      const day = createdAt.toISOString().slice(0, 10);
      dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
    }

    if (!lastUpdatedAt || debate.updatedAt > lastUpdatedAt) {
      lastUpdatedAt = debate.updatedAt;
    }

    const run = debate.latestRun;
    if (!run) {
      continue;
    }

    totalSources += run.sources.length;
    totalTurns += run.turns.length;
    const modelsInDebate = new Set<string>();
    for (const snapshot of run.modelSnapshots) {
      modelsInDebate.add(snapshot.model);
      promptTokens += snapshot.promptTokens ?? 0;
      completionTokens += snapshot.completionTokens ?? 0;
      estimatedCostUsd += snapshot.estimatedCostUsd ?? 0;
    }
    for (const model of modelsInDebate) {
      modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
    }
  }

  const completedDebates = statusCounts.get("complete") ?? 0;
  const activeDebates = debateStatuses
    .filter((status) => !["complete", "failed", "partial"].includes(status))
    .reduce((sum, status) => sum + (statusCounts.get(status) ?? 0), 0);

  return {
    totalDebates: debates.length,
    completedDebates,
    completionRate: debates.length ? completedDebates / debates.length : 0,
    activeDebates,
    recent7Days: debates.filter((debate) => isOnOrAfter(debate.createdAt, sevenDaysAgo)).length,
    recent30Days: debates.filter((debate) => isOnOrAfter(debate.createdAt, thirtyDaysAgo)).length,
    totalSources,
    totalTurns,
    totalFollowups: debates.reduce((sum, debate) => sum + debate.followups.length, 0),
    feedbackCount: feedback.length,
    promptTokens,
    completionTokens,
    estimatedCostUsd,
    statusBreakdown: debateStatuses.map((status) => ({
      status,
      count: statusCounts.get(status) ?? 0
    })),
    dailyActivity: Array.from({ length: 14 }, (_, index) => {
      const date = startOfUtcDay(now, 13 - index);
      const key = date.toISOString().slice(0, 10);
      return {
        date: key,
        label: date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
        count: dayCounts.get(key) ?? 0
      };
    }),
    modelUsage: Array.from(modelCounts, ([model, debates]) => ({ model, debates }))
      .sort((a, b) => b.debates - a.debates || a.model.localeCompare(b.model))
      .slice(0, 10),
    lastUpdatedAt
  };
}

function startOfUtcDay(now: Date, daysAgo: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo));
}

function parseDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isOnOrAfter(value: string, minimum: Date): boolean {
  const date = parseDate(value);
  return Boolean(date && date >= minimum);
}
