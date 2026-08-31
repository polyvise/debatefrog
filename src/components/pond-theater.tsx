"use client";

/**
 * PondTheater — the full-scene "theater mode" renderer for a live debate.
 *
 * A second renderer over the exact same FroglingsLiveState the classic
 * card view consumes: no backend changes, no new events. The pond stays
 * on screen for the whole debate — dusk sky, moon, reeds, fireflies,
 * water — while the three frogs perform:
 *
 *   - preshow: frogs at their pads, intro music, "collecting facts"
 *   - debating: one round at a time. Yes Frog's turn types out first;
 *     once it's done it stays put while No Frog's turn types out beside
 *     it, so both comments are visible together. Once both are done the
 *     scene holds for a couple seconds before the next round begins.
 *   - judging: the pond quiets while the judge frog thinks
 *   - verdict: the lily-pad seesaw tips toward the winner, petals
 *     fall, and confidence fills a water jar
 *
 * Pacing is per round (a pro/con pair held together, then a pause)
 * rather than the classic view's static cards, so the scene reads like
 * a play while still giving a reader time to catch up between rounds.
 */

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { SlowPrint } from "@/components/slow-print";
import { TheaterFrog, type TheaterFrogExpression } from "@/components/theater-frog";
import { FrogSoundsContext } from "@/components/use-frog-sounds";
import { buildFroglingsSourceChips } from "@/lib/source-chips";
import {
  friendlyRound,
  froglingsBubbleText,
  froglingsFrogName,
  froglingsTheaterCaption,
  froglingsVerdictCopy,
  hasAllDebateTurns,
  literalQuestionText
} from "@/lib/froglings-text";
import type { FroglingsLiveState } from "@/components/froglings-workspace";
import type { DebateRound, RoundTurn, Scorecard } from "@polyvise/core/debate/types";

/** Debate rounds in performance order (judge_review/synthesis aren't staged). */
const ROUND_ORDER: DebateRound[] = ["opening", "cross_examination", "rebuttal", "closing"];

/** Read-along pace for theater captions — gentler than SlowPrint's default
 *  ~70 chars/sec, since a bubble here disappears at the end of the round
 *  instead of staying on screen the way classic view's cards do. */
const THEATER_TICK_MS = 20;

/** How long both comments hold on screen, fully typed, before the next
 *  round begins — long enough to reread both without feeling rushed. */
const ROUND_HOLD_MS = 2600;

type TheaterPhase = "preshow" | "debating" | "judging" | "verdict" | "failed";

type VerdictTilt = "yes" | "no" | "level";

function verdictTilt(recommendation: Scorecard["recommendation"]): VerdictTilt {
  switch (recommendation) {
    case "lean_yes":
    case "conditional_yes":
      return "yes";
    case "lean_no":
    case "conditional_no":
      return "no";
    case "mixed":
    default:
      return "level";
  }
}

function verdictBannerLabel(tilt: VerdictTilt): string {
  if (tilt === "yes") return "The frogs ruled YES";
  if (tilt === "no") return "The frogs ruled NO";
  return "Too close to call";
}

/**
 * The motion map: which face each frog wears for the current beat.
 *   Tough Questions — the listener squints at the tricky question.
 *   Comeback        — the speaker goes smug; the listener's eyes dart.
 *   Last Word       — both debaters beam, standing tall.
 *   Judging         — the judge looks up, thinking.
 *
 * `activeSide` is whichever frog currently "has the floor" for
 * reaction purposes — Yes Frog while its comment is out (typing or
 * freshly finished), No Frog from the moment Yes Frog wraps up (even
 * before No Frog's own bubble appears, so it already reads as
 * reacting) through the end of the round.
 */
function frogExpression(
  side: "pro" | "con" | "judge",
  phase: TheaterPhase,
  round: DebateRound | null,
  activeSide: "pro" | "con" | null
): TheaterFrogExpression {
  if (phase === "judging") return side === "judge" ? "think" : "idle";
  if (side === "judge" || phase !== "debating" || !round) return "idle";
  if (round === "closing") return "proud";
  if (!activeSide) return "idle";
  const isActive = side === activeSide;
  if (round === "rebuttal") return isActive ? "smug" : "dart";
  if (round === "cross_examination" && !isActive) return "squint";
  return "idle";
}

export function PondTheater({ live }: { live: FroglingsLiveState }) {
  const sounds = useContext(FrogSoundsContext);
  const [roundIndex, setRoundIndex] = useState(0);
  const [proDone, setProDone] = useState(false);
  const [typingSide, setTypingSide] = useState<"pro" | "con" | null>(null);
  const advanceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setRoundIndex(0);
    setProDone(false);
    setTypingSide(null);
  }, [live.debateId]);

  useEffect(() => {
    return () => {
      if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current);
    };
  }, []);

  const handleProComplete = useCallback(() => {
    setProDone(true);
  }, []);

  // No Frog finishing is the cue for the whole round: hold both
  // comments on screen a beat, then clear them and move to the next
  // round.
  const handleConComplete = useCallback(() => {
    if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current);
    advanceTimerRef.current = window.setTimeout(() => {
      advanceTimerRef.current = null;
      setRoundIndex((index) => index + 1);
      setProDone(false);
      setTypingSide(null);
    }, ROUND_HOLD_MS);
  }, []);

  const currentRound: DebateRound | null = ROUND_ORDER[roundIndex] ?? null;
  const roundTurns = useMemo(
    () => (currentRound ? live.turns.filter((turn) => turn.round === currentRound) : []),
    [live.turns, currentRound]
  );
  const proTurn = roundTurns.find((turn) => turn.side === "pro") ?? null;
  const conTurn = roundTurns.find((turn) => turn.side === "con") ?? null;

  const allRoundsHeld = roundIndex >= ROUND_ORDER.length;
  const hasVerdict = Boolean(live.summary && live.scorecard);
  const debateBroke = live.status === "failed" || live.status === "partial";
  // The debate ended without ever producing a turn this round is
  // waiting on — don't sit forever showing a "thinking" bubble that
  // will never resolve.
  const roundStuck = live.done && currentRound !== null && (!proTurn || (proDone && !conTurn));

  const phase: TheaterPhase =
    debateBroke && (live.turns.length === 0 || roundStuck)
      ? "failed"
      : allRoundsHeld && hasVerdict
        ? "verdict"
        : allRoundsHeld && hasAllDebateTurns(live.turns)
          ? "judging"
          : live.turns.length > 0 || live.status === "debating"
            ? "debating"
            : "preshow";

  const isPreshow = phase === "preshow";
  const proThinking = phase === "debating" && !proTurn;
  const conThinking = phase === "debating" && proDone && !conTurn;
  // Whichever frog currently "has the floor": Yes Frog until it wraps
  // up, then No Frog for the rest of the round (even the moment before
  // its own bubble appears, so it already reads as reacting).
  const activeSide: "pro" | "con" | null = phase === "debating" ? (proDone ? "con" : "pro") : null;

  // Soft music bed while the stage warms up, same cue the classic splash uses.
  useEffect(() => {
    if (!isPreshow || !sounds.ready) return;
    sounds.startIntro();
    return () => {
      sounds.stopIntro();
    };
  }, [isPreshow, sounds]);

  // One croak from the judge when the verdict lands.
  const verdictCroakRef = useRef(false);
  useEffect(() => {
    if (phase !== "verdict" || verdictCroakRef.current || !sounds.ready) return;
    verdictCroakRef.current = true;
    sounds.play("judge");
    const timer = window.setTimeout(() => sounds.stop("judge"), 480);
    return () => {
      window.clearTimeout(timer);
      sounds.stop("judge");
    };
  }, [phase, sounds]);
  useEffect(() => {
    verdictCroakRef.current = false;
  }, [live.debateId]);

  const speakingSide = phase === "debating" ? typingSide : null;
  const tilt = live.scorecard ? verdictTilt(live.scorecard.recommendation) : "level";
  const allTurns = live.turns;

  return (
    <div className="mt-6 space-y-4">
      <section className="rounded-2xl border border-mud/20 bg-panel/95 px-5 py-3.5 shadow-sm backdrop-blur">
        <div className="text-[11px] font-extrabold uppercase tracking-wide text-mud/60">Question</div>
        <div className="mt-0.5 text-base leading-snug text-ink">{literalQuestionText(live.subject)}</div>
      </section>

      <section className="pt-stage" aria-label="Pond theater stage">
        <PondScenery />

        <div className="pt-plaque" aria-live="polite">
          <PlaqueCopy phase={phase} live={live} round={currentRound} />
        </div>

        {phase === "verdict" && live.scorecard ? (
          <VerdictScene tilt={tilt} />
        ) : (
          <div className="pt-troupe">
            <PadGroup
              side="pro"
              speaking={speakingSide === "pro"}
              thinking={proThinking || (isPreshow && !debateBroke)}
              expression={frogExpression("pro", phase, currentRound, activeSide)}
            />
            <PadGroup
              side="judge"
              speaking={phase === "judging"}
              thinking={false}
              expression={frogExpression("judge", phase, currentRound, activeSide)}
            />
            <PadGroup
              side="con"
              speaking={speakingSide === "con"}
              thinking={conThinking || (isPreshow && !debateBroke)}
              expression={frogExpression("con", phase, currentRound, activeSide)}
            />
          </div>
        )}

        {phase === "debating" ? (
          <>
            {proTurn ? (
              <TheaterBubble
                key={proTurn.id}
                turn={proTurn}
                live={live}
                onTypingChange={(typing) => setTypingSide(typing ? "pro" : null)}
                onComplete={handleProComplete}
              />
            ) : (
              <ThinkingBubble side="pro" />
            )}
            {proDone ? (
              conTurn ? (
                <TheaterBubble
                  key={conTurn.id}
                  turn={conTurn}
                  live={live}
                  onTypingChange={(typing) => setTypingSide(typing ? "con" : null)}
                  onComplete={handleConComplete}
                />
              ) : (
                <ThinkingBubble side="con" />
              )
            ) : null}
          </>
        ) : null}

        {phase === "failed" ? (
          <div className="pt-failed" role="alert">
            {live.errorMessage ?? "Uh oh — the frogs slipped off the lily pad. Please try again."}
          </div>
        ) : null}
      </section>

      {phase === "verdict" && live.scorecard ? <VerdictCard live={live} tilt={tilt} /> : null}

      {allRoundsHeld && allTurns.length > 0 ? <Transcript live={live} turns={allTurns} /> : null}
    </div>
  );
}

// -------------------------------------------------------------------------
// Scenery — sky, moon, stars, hills, reeds, water, fireflies. Static
// positions are chosen once per mount so the night sky doesn't reshuffle
// on every render.
// -------------------------------------------------------------------------

function PondScenery() {
  const stars = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => ({
        id: index,
        left: 4 + Math.random() * 92,
        top: 3 + Math.random() * 24,
        delay: Math.random() * 4
      })),
    []
  );
  const fireflies = useMemo(
    () =>
      Array.from({ length: 8 }, (_, index) => ({
        id: index,
        left: 6 + Math.random() * 88,
        top: 32 + Math.random() * 44,
        driftDelay: Math.random() * 6,
        flickerDelay: Math.random() * 3,
        driftDuration: 7 + Math.random() * 6,
        flickerDuration: 2 + Math.random() * 2
      })),
    []
  );

  return (
    <>
      <div className="pt-moon" aria-hidden="true" />
      {stars.map((star) => (
        <span
          key={star.id}
          className="pt-star"
          aria-hidden="true"
          style={{ left: `${star.left}%`, top: `${star.top}%`, animationDelay: `${star.delay}s` }}
        />
      ))}
      <div className="pt-hills" aria-hidden="true">
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none">
          <path
            d="M0 100 L0 62 Q140 30 300 55 Q470 78 640 42 Q820 12 1000 48 L1000 100 Z"
            fill="currentColor"
          />
        </svg>
      </div>
      <div className="pt-water" aria-hidden="true">
        <span className="pt-glint" style={{ left: "12%", top: "24%", width: "70px" }} />
        <span className="pt-glint" style={{ left: "44%", top: "48%", width: "110px", animationDelay: "2s" }} />
        <span className="pt-glint" style={{ left: "70%", top: "18%", width: "60px", animationDelay: "4s" }} />
        <span className="pt-glint" style={{ left: "26%", top: "70%", width: "90px", animationDelay: "1s" }} />
      </div>
      <Reeds className="pt-reeds-left" />
      <Reeds className="pt-reeds-right" />
      {fireflies.map((fly) => (
        <span
          key={fly.id}
          className="pt-firefly"
          aria-hidden="true"
          style={{
            left: `${fly.left}%`,
            top: `${fly.top}%`,
            animationDelay: `${fly.driftDelay}s, ${fly.flickerDelay}s`,
            animationDuration: `${fly.driftDuration}s, ${fly.flickerDuration}s`
          }}
        />
      ))}
      <div className="pt-dragonfly" aria-hidden="true">
        <svg viewBox="0 0 56 34">
          <g className="pt-dragonfly-wing">
            <ellipse cx="22" cy="8" rx="12" ry="5" fill="#bfe6ff" opacity="0.75" transform="rotate(-22 22 8)" />
            <ellipse cx="34" cy="8" rx="12" ry="5" fill="#bfe6ff" opacity="0.75" transform="rotate(22 34 8)" />
          </g>
          <rect x="16" y="12" width="30" height="4" rx="2" fill="#3f6a8a" />
          <circle cx="14" cy="14" r="5" fill="#3f6a8a" />
        </svg>
      </div>
    </>
  );
}

function Reeds({ className }: { className: string }) {
  return (
    <div className={`pt-reeds ${className}`} aria-hidden="true">
      <svg viewBox="0 0 200 240">
        <g fill="currentColor" stroke="currentColor">
          <path d="M40 240 Q34 150 44 90" strokeWidth="5" fill="none" />
          <ellipse cx="44" cy="74" rx="9" ry="26" stroke="none" />
          <path d="M78 240 Q86 140 74 70" strokeWidth="5" fill="none" />
          <ellipse cx="73" cy="52" rx="9" ry="27" stroke="none" />
          <path d="M112 240 Q108 180 118 130" strokeWidth="4" fill="none" />
          <ellipse cx="119" cy="114" rx="7" ry="21" stroke="none" />
          <path d="M20 240 Q40 170 22 120 M140 240 Q150 200 142 168" strokeWidth="3" fill="none" />
        </g>
      </svg>
    </div>
  );
}

// -------------------------------------------------------------------------
// Frogs on lily pads
// -------------------------------------------------------------------------

function LilyPad({ small = false }: { small?: boolean }) {
  return (
    <svg className={small ? "pt-lily pt-lily-small" : "pt-lily"} viewBox="0 0 180 44" aria-hidden="true">
      <ellipse cx="90" cy="22" rx="86" ry="19" fill="#3f8a5c" />
      <path d="M90 22 L168 12 A86 19 0 0 0 160 8 Z" fill="#2c6647" />
      <ellipse cx="90" cy="19" rx="78" ry="14" fill="#ffffff" opacity="0.07" />
    </svg>
  );
}

function PadGroup({
  side,
  speaking,
  thinking,
  expression
}: {
  side: "pro" | "con" | "judge";
  speaking: boolean;
  thinking: boolean;
  expression: TheaterFrogExpression;
}) {
  const sounds = useContext(FrogSoundsContext);
  const croakTimerRef = useRef<number | null>(null);

  // Easter egg: tapping a frog gets you a real croak from the clip pool.
  const croak = () => {
    sounds.play(side, { random: true });
    if (croakTimerRef.current !== null) window.clearTimeout(croakTimerRef.current);
    croakTimerRef.current = window.setTimeout(() => {
      croakTimerRef.current = null;
      sounds.stop(side);
    }, 420);
  };

  // The clip loops until stopped, so never leave one running past unmount.
  useEffect(() => {
    return () => {
      if (croakTimerRef.current !== null) {
        window.clearTimeout(croakTimerRef.current);
        sounds.stop(side);
      }
    };
  }, [side, sounds]);

  const frogName = side === "judge" ? "Judge Frog" : froglingsFrogName(side);
  const posture = `${expression === "squint" ? " is-leaning" : ""}${
    expression === "proud" ? " is-proud" : ""
  }`;

  return (
    <div
      className={`pt-pad-group pt-pad-${side}${speaking ? " is-speaking-group" : ""}${
        thinking ? " is-thinking" : ""
      }${posture}`}
    >
      <button
        type="button"
        className="pt-frog-wrap"
        onClick={croak}
        aria-label={`${frogName} — tap for a croak`}
      >
        <TheaterFrog mood={side} speaking={speaking} expression={expression} className="pt-frog" />
        <div className="pt-reflection" aria-hidden="true">
          <TheaterFrog mood={side} speaking={false} expression={expression} className="pt-frog" />
        </div>
      </button>
      <LilyPad />
      <span className="pt-ripple" aria-hidden="true" />
    </div>
  );
}

// -------------------------------------------------------------------------
// Speech + status bubbles
// -------------------------------------------------------------------------

function TheaterBubble({
  turn,
  live,
  onTypingChange,
  onComplete
}: {
  turn: RoundTurn;
  live: FroglingsLiveState;
  onTypingChange: (typing: boolean) => void;
  onComplete: () => void;
}) {
  const side = turn.side === "con" ? "con" : "pro";
  const sounds = useContext(FrogSoundsContext);
  const content = froglingsTheaterCaption(turn);
  const sourceChips = buildFroglingsSourceChips(turn.sourceIds, live.sources);

  // Frog-speak: one voice blip per revealed vowel, so the croak-voice
  // follows the rhythm of the words (the hook throttles the rate).
  // Consonant runs and spaces read as the gaps between syllables.
  const handleProgress = (lastChar: string) => {
    if (/[aeiouy0-9]/i.test(lastChar)) sounds.blip(side);
  };

  return (
    <div className={`pt-bubble pt-bubble-${side} hop-in`}>
      <div className="pt-bubble-who">{froglingsFrogName(side)}</div>
      <p className="pt-bubble-text">
        <SlowPrint
          text={content}
          tickMs={THEATER_TICK_MS}
          onTypingChange={onTypingChange}
          onComplete={onComplete}
          onProgress={handleProgress}
        />
      </p>
      {sourceChips.length > 0 ? (
        <div className="pt-bubble-sources" aria-label="Sources for this turn">
          {sourceChips.map((chip) => (
            <a
              key={chip.id}
              href={chip.url}
              target="_blank"
              rel="noreferrer"
              title={`${chip.label}${chip.detail ? ` — ${chip.detail}` : ""}`}
              className="pt-source-chip"
            >
              <span className="truncate">{chip.label}</span>
              <ExternalLink className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ThinkingBubble({ side }: { side: "pro" | "con" }) {
  return (
    <div className={`pt-bubble pt-bubble-${side} pt-bubble-thinking hop-in`}>
      <div className="pt-bubble-who">{froglingsFrogName(side)}</div>
      <p className="pt-bubble-text pt-thinking-dots" aria-label={`${froglingsFrogName(side)} is thinking`}>
        <span />
        <span />
        <span />
      </p>
    </div>
  );
}

function PlaqueCopy({
  phase,
  live,
  round
}: {
  phase: TheaterPhase;
  live: FroglingsLiveState;
  round: DebateRound | null;
}) {
  if (phase === "debating" && round) {
    const meta = friendlyRound[round];
    const [roundLabel, roundName] = meta.title.split(" — ");
    return (
      <>
        <b>{roundLabel}</b>
        {roundName ? <> · {roundName}</> : null}
      </>
    );
  }
  if (phase === "verdict") return <b>The verdict</b>;
  if (phase === "judging") return <>The judge frog is thinking…</>;
  if (phase === "failed") return <>Intermission — the frogs slipped</>;
  if (live.status === "researching") return <>The frogs are collecting facts…</>;
  return <>The lily pad stage is lighting up…</>;
}

// -------------------------------------------------------------------------
// Verdict — lily-pad seesaw, petals, banner
// -------------------------------------------------------------------------

function VerdictScene({ tilt }: { tilt: VerdictTilt }) {
  // Flip to "live" a beat after mount so the beam visibly tips and the
  // banner blooms instead of appearing pre-settled.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(true), 500);
    return () => window.clearTimeout(timer);
  }, []);

  const petals = useMemo(
    () =>
      Array.from({ length: 22 }, (_, index) => ({
        id: index,
        left: Math.random() * 100,
        size: 7 + Math.random() * 8,
        dx: Math.random() * 120 - 60,
        rot: Math.random() * 720 - 360,
        duration: 3 + Math.random() * 2.6,
        delay: Math.random() * 1.4,
        color: ["#e8a3b4", "#fff7dd", "#f4c95d", "#f4b4c4"][index % 4]
      })),
    []
  );

  return (
    <div className={`pt-verdict-scene${settled ? ` is-settled pt-tilt-${tilt}` : ""}`}>
      <div className="pt-verdict-banner">
        <div className="pt-verdict-banner-sub">Judge&apos;s pick</div>
        <div className="pt-verdict-banner-ruling">{verdictBannerLabel(tilt)}</div>
      </div>
      <div className="pt-judge-perch">
        <TheaterFrog mood="judge" speaking={false} className="pt-frog" />
      </div>
      <div className="pt-seesaw">
        <div className="pt-beam">
          <div className="pt-seat pt-seat-yes">
            <TheaterFrog
              mood="pro"
              speaking={false}
              expression={tilt === "yes" ? "proud" : "idle"}
              className="pt-frog"
            />
            <LilyPad small />
          </div>
          <div className="pt-seat pt-seat-no">
            <TheaterFrog
              mood="con"
              speaking={false}
              expression={tilt === "no" ? "proud" : "idle"}
              className="pt-frog"
            />
            <LilyPad small />
          </div>
        </div>
        <div className="pt-fulcrum" />
      </div>
      {settled
        ? petals.map((petal) => (
            <span
              key={petal.id}
              className="pt-petal"
              aria-hidden="true"
              style={{
                left: `${petal.left}%`,
                width: `${petal.size}px`,
                height: `${petal.size * 1.4}px`,
                background: petal.color,
                animationDuration: `${petal.duration}s`,
                animationDelay: `${petal.delay}s`,
                ["--pt-petal-dx" as string]: `${petal.dx.toFixed(0)}px`,
                ["--pt-petal-rot" as string]: `${petal.rot.toFixed(0)}deg`
              }}
            />
          ))
        : null}
    </div>
  );
}

function VerdictCard({ live, tilt }: { live: FroglingsLiveState; tilt: VerdictTilt }) {
  const scorecard = live.scorecard!;
  const pct = Math.round(scorecard.confidence * 100);
  const copy = froglingsVerdictCopy(scorecard, live.topicKind, live.summary);
  const [filled, setFilled] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setFilled(true), 350);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <section className="hop-in rounded-2xl border border-mud/20 bg-panel/95 p-5 shadow-lily">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-wide ${
              tilt === "yes"
                ? "bg-mint/80 text-pond"
                : tilt === "no"
                  ? "bg-lily/70 text-berry"
                  : "bg-[#9978b8]/15 text-[#5c4583]"
            }`}
          >
            Judge&apos;s pick · {verdictBannerLabel(tilt)}
          </div>
          <h2 className="mt-3 text-xl font-black leading-snug text-pond">{copy.headline}</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink/85">{copy.body}</p>
        </div>
        <div className="flex shrink-0 items-center gap-4 sm:flex-col sm:items-end">
          <div className="pt-jar" aria-label={`How sure: ${pct} percent`}>
            <div className="pt-jar-fill" style={{ height: filled ? `${pct}%` : "0%" }} />
            <div className="pt-jar-pct">{pct}%</div>
          </div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-mud/60">How sure?</div>
        </div>
      </div>
    </section>
  );
}

// -------------------------------------------------------------------------
// Transcript — the whole debate in plain cards, for re-reading after the
// performance (and as the screen-reader-friendly record).
// -------------------------------------------------------------------------

function Transcript({ live, turns }: { live: FroglingsLiveState; turns: RoundTurn[] }) {
  return (
    <details className="rounded-2xl border border-mud/20 bg-panel/90 shadow-sm">
      <summary className="cursor-pointer select-none px-5 py-3.5 text-sm font-black text-pond">
        Read the whole debate
      </summary>
      <div className="space-y-4 px-5 pb-5">
        {(["opening", "cross_examination", "rebuttal", "closing"] as const).map((round) => {
          const roundTurns = turns.filter((turn) => turn.round === round);
          if (roundTurns.length === 0) return null;
          const meta = friendlyRound[round];
          return (
            <article key={round}>
              <div className="text-sm font-black text-pond">{meta.title}</div>
              <div className="mt-0.5 text-xs text-ink/65">{meta.blurb}</div>
              <div className="mt-2 grid gap-3 md:grid-cols-2">
                {roundTurns.map((turn) => (
                  <div
                    key={turn.id}
                    className={`rounded-xl border px-4 py-3 ${
                      turn.side === "pro" ? "border-leaf/30 bg-mint/50" : "border-berry/30 bg-lily/40"
                    }`}
                  >
                    <div className="mb-1 text-xs font-black text-ink">
                      {froglingsFrogName(turn.side === "con" ? "con" : "pro")}
                    </div>
                    <p className="text-sm leading-relaxed text-ink/85">{froglingsBubbleText(turn)}</p>
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </details>
  );
}
