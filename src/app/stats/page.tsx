import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Database } from "lucide-react";
import { FunFrog } from "@/components/fun-frog";
import { getPublicStats, type PublicStats } from "@/server/stats";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Pond stats | DebateFrog",
  description: "Aggregate activity and model usage from the DebateFrog pond."
};

export default async function StatsPage() {
  let stats: PublicStats | null = null;
  let unavailable = false;

  try {
    stats = await getPublicStats();
  } catch (error) {
    unavailable = true;
    console.error("Unable to load DebateFrog stats", error);
  }

  return (
    <main className="pond-stats-page min-h-screen px-4 py-6 text-ink sm:py-10">
      <div className="mx-auto max-w-[928px]">
        <header className="workspace-navigation mb-9 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex min-h-11 items-center gap-3 rounded-lg text-lg font-black tracking-tight text-cream">
            <FunFrog mood="idle" size={42} bob={false} />
            <span>DebateFrog</span>
          </Link>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/90 px-4 py-2 text-sm font-bold text-pond shadow-sm transition hover:bg-white"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Ask a question
          </Link>
        </header>

        <section className="mb-8">
          <h1 className="text-3xl font-black tracking-tight text-cream sm:text-4xl">
            What&apos;s hopping in the pond?
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#cbd9d2] sm:text-base">
            A privacy-friendly look at DebateFrog activity. These are totals only—questions,
            answers, follow-ups, and feedback messages stay out of this page.
          </p>
        </section>

        {unavailable || !stats ? (
          <section className="rounded-2xl bg-panel p-8 text-center shadow-sm" role="status">
            <p className="font-black text-pond">The pond counter is taking a little nap.</p>
            <p className="mt-2 text-sm text-mud">Please hop back soon.</p>
          </section>
        ) : (
          <StatsContent stats={stats} />
        )}
      </div>
    </main>
  );
}

function StatsContent({ stats }: { stats: PublicStats }) {
  const maxDaily = Math.max(1, ...stats.dailyActivity.map((day) => day.count));
  const maxStatus = Math.max(1, ...stats.statusBreakdown.map((item) => item.count));
  const maxModel = Math.max(1, ...stats.modelUsage.map((item) => item.debates));

  return (
    <div className="space-y-6">
      <section aria-label="Pond activity totals" className="stats-totals grid grid-cols-2 overflow-hidden rounded-2xl bg-panel p-2 shadow-sm sm:grid-cols-4">
        <Metric label="Total debates" value={formatNumber(stats.totalDebates)} />
        <Metric label="Completed" value={`${Math.round(stats.completionRate * 100)}%`} detail={`${formatNumber(stats.completedDebates)} debates`} />
        <Metric label="Last 7 days" value={formatNumber(stats.recent7Days)} detail={`${formatNumber(stats.recent30Days)} in 30 days`} />
        <Metric label="Feedback notes" value={formatNumber(stats.feedbackCount)} />
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Debates over the last 14 days" subtitle="New debates per day">
          <div className="flex h-52 items-end gap-1.5 pt-5 sm:gap-3">
            {stats.dailyActivity.map((day, index) => (
              <div key={day.date} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-2">
                <span className="text-[10px] font-bold tabular-nums text-pond">{day.count || ""}</span>
                <div
                  className="w-full min-w-2 rounded-t-lg bg-leaf transition-all"
                  style={{ height: `${Math.max(day.count ? 12 : 3, (day.count / maxDaily) * 150)}px`, opacity: day.count ? 1 : 0.18 }}
                  title={`${day.label}: ${day.count}`}
                />
                <span className="hidden h-4 whitespace-nowrap text-[10px] font-semibold leading-4 text-mud sm:block">
                  {index % 2 === 0 ? day.label : ""}
                </span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Debate outcomes" subtitle={`${stats.activeDebates} currently active`}>
          <div className="space-y-3">
            {stats.statusBreakdown.map((item) => (
              <BarRow
                key={item.status}
                label={statusLabel(item.status)}
                value={item.count}
                width={(item.count / maxStatus) * 100}
                color="bg-berry"
              />
            ))}
          </div>
        </Panel>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Panel title="Models in the pond" subtitle="Debates using each model">
          {stats.modelUsage.length ? (
            <div className="space-y-3">
              {stats.modelUsage.map((item) => (
                <BarRow key={item.model} label={shortModel(item.model)} value={item.debates} width={(item.debates / maxModel) * 100} color="bg-[#9978b8]" />
              ))}
            </div>
          ) : (
            <EmptyState />
          )}
        </Panel>

        <Panel title="What the frogs produced" subtitle="Aggregate output from completed and partial runs">
          <div className="grid grid-cols-2 gap-3">
            <SmallMetric label="Evidence sources" value={stats.totalSources} />
            <SmallMetric label="Debate turns" value={stats.totalTurns} />
            <SmallMetric label="Follow-up answers" value={stats.totalFollowups} />
            <SmallMetric label="Model tokens" value={stats.promptTokens + stats.completionTokens} />
          </div>
          <div className="mt-5 flex items-start gap-2 border-t border-pond/15 pt-4 text-xs leading-5 text-mud">
            <Database className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Aggregate counts from DebateFrog&apos;s Firestore collection
          </div>
        </Panel>
      </section>

      <p className="pb-4 text-center text-xs text-[#cbd9d2]">
        {stats.lastUpdatedAt
          ? `Latest activity ${new Date(stats.lastUpdatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`
          : "No debate activity recorded yet"}
      </p>
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="p-4 sm:p-5">
      <div className="text-3xl font-black tabular-nums text-pond">{value}</div>
      <div className="mt-1 text-sm font-bold text-mud">{label}</div>
      {detail ? <div className="mt-1 text-xs text-mud">{detail}</div> : null}
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl bg-panel p-5 shadow-sm sm:p-6">
      <h2 className="text-lg font-black text-pond">{title}</h2>
      <p className="mb-5 mt-1 text-xs leading-5 text-mud">{subtitle}</p>
      {children}
    </section>
  );
}

function BarRow({ label, value, width, color }: { label: string; value: number; width: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
        <span className="truncate font-bold text-mud" title={label}>{label}</span>
        <span className="font-black tabular-nums text-pond">{formatNumber(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-pond/10">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function SmallMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="py-3">
      <div className="text-2xl font-black tabular-nums text-pond">{formatNumber(value)}</div>
      <div className="mt-1 text-xs font-bold text-mud">{label}</div>
    </div>
  );
}

function EmptyState() {
  return <p className="py-5 text-sm text-mud">No model runs yet.</p>;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function statusLabel(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shortModel(model: string) {
  return model.split("/").pop()?.replace(/[-_]+/g, " ") ?? model;
}
