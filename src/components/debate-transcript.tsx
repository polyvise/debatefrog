import { ExternalLink } from "lucide-react";
import type { EvidenceSource, RoundTurn } from "@polyvise/core/debate/types";
import { buildFroglingsSourceChips } from "@/lib/source-chips";
import { friendlyRound, froglingsBubbleText, froglingsFrogName } from "@/lib/froglings-text";

const transcriptRounds = ["opening", "cross_examination", "rebuttal", "closing"] as const;

export function DebateTranscript({ sources, turns }: { sources: EvidenceSource[]; turns: RoundTurn[] }) {
  const visibleTurns = turns.filter(turn => transcriptRounds.some(round => round === turn.round));
  const sourcesUsed = buildFroglingsSourceChips(visibleTurns.flatMap(turn => turn.sourceIds), sources, Infinity);
  const sourceById = new Map(sources.map(source => [source.id, source]));

  return (
    <details className="rounded-2xl border border-mud/20 bg-panel/90 shadow-sm">
      <summary className="cursor-pointer select-none rounded-2xl px-5 py-3.5 text-sm font-black text-pond focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pond">
        Read the whole debate
      </summary>
      <div className="space-y-4 px-5 pb-5">
        {transcriptRounds.map(round => {
          const roundTurns = turns.filter(turn => turn.round === round);
          if (roundTurns.length === 0) return null;
          const meta = friendlyRound[round];
          return (
            <article key={round}>
              <h3 className="text-sm font-black text-pond">{meta.title}</h3>
              <div className="mt-0.5 text-xs text-ink/65">{meta.blurb}</div>
              <div className="mt-2 grid gap-3 md:grid-cols-2">
                {roundTurns.map(turn => {
                  const citations = buildFroglingsSourceChips(turn.sourceIds, sources, Infinity);
                  const frog = froglingsFrogName(turn.side === "con" ? "con" : "pro");
                  return (
                    <div key={turn.id} className={`min-w-0 rounded-xl border px-4 py-3 ${turn.side === "pro" ? "border-leaf/30 bg-mint/50" : "border-berry/30 bg-lily/40"}`}>
                      <div className="mb-1 text-xs font-black text-ink">{frog}</div>
                      <p className="text-sm leading-relaxed text-ink/85">{froglingsBubbleText(turn)}</p>
                      {citations.length > 0 ? (
                        <div className="mt-3 border-t border-ink/10 pt-2">
                          <p className="text-xs font-bold text-ink/80">Sources for this point</p>
                          <ul aria-label={`Sources for ${frog} — ${meta.title}`} className="flex flex-wrap gap-x-4">
                            {citations.map(source => (
                              <li key={source.id} className="min-w-0 max-w-full">
                                <a href={source.url} target="_blank" rel="noopener noreferrer" title={sourceById.get(source.id)?.title} className="inline-flex min-h-11 items-center gap-1.5 rounded-sm py-2 text-xs font-bold text-pond underline decoration-pond/40 underline-offset-4 hover:decoration-pond focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pond">
                                  <span className="break-words [overflow-wrap:anywhere]">{source.label}</span>
                                  <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                                  <span className="sr-only"> (opens in a new tab)</span>
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </article>
          );
        })}
        <section aria-label="Sources used" className="border-t border-mud/20 pt-5">
          <h3 className="text-sm font-black text-pond">Sources used</h3>
          {sourcesUsed.length > 0 ? (
            <>
              <p className="mt-1 text-xs text-ink/80">Read more about the points above. Links open in a new tab.</p>
              <ul className="mt-2 divide-y divide-mud/15">
                {sourcesUsed.map(source => (
                  <li key={source.id} className="py-2">
                    <a href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-sm py-2 text-sm font-bold text-pond underline decoration-pond/40 underline-offset-4 hover:decoration-pond focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pond">
                      <span className="break-words [overflow-wrap:anywhere]">{sourceById.get(source.id)?.title.trim() || source.label}</span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                    {source.detail ? <p className="text-xs leading-relaxed text-ink/80 [overflow-wrap:anywhere]">{source.detail}</p> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : <p className="mt-1 text-sm text-ink/80">No linked sources were saved for these points.</p>}
        </section>
      </div>
    </details>
  );
}
