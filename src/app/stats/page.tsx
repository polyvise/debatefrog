import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, Database, MessageCircle, Sparkles } from "lucide-react";
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
    <main className="min-h-screen bg-cream px-4 py-8 text-ink sm:py-12">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <Link href="/" className="inline-flex items-center gap-2 font-black text-pond">
            <Sparkles className="h-7 w-7" />
            DebateFrog
          </Link>
          <Link
            href="/"
            className="rounded-full bg-white/80 px-4 py-2 text-sm font-bold text-pond shadow-sm transition hover:bg-white"
          >
            Ask a question
          </Link>
        </header>

        <section className="mb-8 rounded-[2rem] border border-leaf/20 bg-panel p-6 shadow-lily sm:p-9">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-mint px-3 py-1 text-xs font-black uppercase tracking-wider text-pond">
            <BarChart3 className="h-4 w-4" />
            Pond stats
          </div>
          <h1 className="text-3xl font-black tracking-tight text-pond sm:text-5xl">
            What&apos;s hopping in the pond?
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-mud/80 sm:text-base">
            A privacy-friendly look at DebateFrog activity. These are totals only—questions,
            answers, follow-ups, and feedback messages stay out of this page.
          </p>
        </section>

        {unavailable || !stats ? (
          <section className="rounded-3xl border border-berry/20 bg-white p-8 text-center shadow-sm">
            <p className="font-black text-pond">The pond counter is taking a little nap.</p>
            <p className="mt-2 text-sm text-mud/70">Please hop back soon.</p>
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
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Total debates" value={formatNumber(stats.totalDebates)} icon={<Sparkles className="h-5 w-5" />} />
        <Metric label="Completed" value={`${Math.round(stats.completionRate * 100)}%`} detail={`${formatNumber(stats.completedDebates)} debates`} icon={<Sparkles className="h-5 w-5" />} />
        <Metric label="Last 7 days" value={formatNumber(stats.recent7Days)} detail={`${formatNumber(stats.recent30Days)} in 30 days`} icon={<BarChart3 className="h-5 w-5" />} />
        <Metric label="Feedback notes" value={formatNumber(stats.feedbackCount)} icon={<MessageCircle className="h-5 w-5" />} />
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Debates over the last 14 days" subtitle="New debates per day">
          <div className="flex h-52 items-end gap-1.5 pt-5 sm:gap-3">
            {stats.dailyActivity.map((day, index) => (
              <div key={day.date} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-2">
                <span className="text-[10px] font-bold text-pond">{day.count || ""}</span>
                <div
                  className="w-full min-w-2 rounded-t-lg bg-leaf transition-all"
                  style={{ height: `${Math.max(day.count ? 12 : 3, (day.count / maxDaily) * 150)}px`, opacity: day.count ? 1 : 0.18 }}
                  title={`${day.label}: ${day.count}`}
                />
                <span className="hidden text-[9px] font-semibold text-mud/60 sm:block">
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
                <BarRow key={item.model} label={shortModel(item.model)} value={item.debates} width={(item.debates / maxModel) * 100} color="bg-sun" />
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
          <div className="mt-4 flex items-center gap-2 rounded-2xl bg-mint/60 px-4 py-3 text-xs font-semibold text-pond">
            <Database className="h-4 w-4 shrink-0" />
            Aggregate counts from DebateFrog&apos;s Firestore collection
          </div>
        </Panel>
      </section>

      <p className="pb-4 text-center text-[11px] font-semibold text-mud/50">
        {stats.lastUpdatedAt
          ? `Latest activity ${new Date(stats.lastUpdatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`
          : "No debate activity recorded yet"}
      </p>
    </div>
  );
}

function Metric({ label, value, detail, icon }: { label: string; value: string; detail?: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-leaf/15 bg-white p-5 shadow-sm">
      <div className="mb-4 inline-flex rounded-xl bg-mint p-2 text-pond">{icon}</div>
      <div className="text-3xl font-black text-pond">{value}</div>
      <div className="mt-1 text-sm font-bold text-mud">{label}</div>
      {detail ? <div className="mt-1 text-xs text-mud/55">{detail}</div> : null}
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-leaf/15 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-lg font-black text-pond">{title}</h2>
      <p className="mb-5 mt-1 text-xs font-semibold text-mud/55">{subtitle}</p>
      {children}
    </section>
  );
}

function BarRow({ label, value, width, color }: { label: string; value: number; width: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
        <span className="truncate font-bold text-mud" title={label}>{label}</span>
        <span className="font-black text-pond">{formatNumber(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-mint/60">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function SmallMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-cream p-4">
      <div className="text-2xl font-black text-pond">{formatNumber(value)}</div>
      <div className="mt-1 text-xs font-bold text-mud/65">{label}</div>
    </div>
  );
}

function EmptyState() {
  return <p className="rounded-2xl bg-cream p-5 text-sm font-semibold text-mud/60">No model runs yet.</p>;
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
