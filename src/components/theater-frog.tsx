import type { SVGProps } from "react";

/**
 * TheaterFrog — the richer character rig used by the pond theater.
 *
 * Compared to FunFrog it adds:
 *   - a throat sac that inflates while speaking (the classic croak tell)
 *   - an open-mouth shape that chatters with the typewriter
 *   - haunches, front feet, nostrils, and a soft body highlight
 *   - the judge's robe, collar, and wig
 *
 * Animation is class-driven (see the "pond theater" section of
 * globals.css): the root carries `theater-frog` plus `is-speaking` when
 * the frog currently has the floor. All motion honors
 * `prefers-reduced-motion` via globals.css.
 *
 * Expressions map the debate's round to a face, per the theater's
 * motion map:
 *   - "squint": listener narrows its eyes during Tough Questions
 *   - "smug":   speaker's half-grin during the Comeback round
 *   - "dart":   listener's eyes flick side to side during Comeback
 *   - "proud":  both frogs beam during the Last Word
 *   - "think":  eyes drift up while composing (or judging)
 */

export type TheaterFrogMood = "pro" | "con" | "judge";

export type TheaterFrogExpression = "idle" | "squint" | "smug" | "dart" | "proud" | "think";

const palette: Record<
  TheaterFrogMood,
  { body: string; shade: string; belly: string; cheek: string; mouth: string; throat: string }
> = {
  pro: {
    body: "#44a15f",
    shade: "#2c6e45",
    belly: "#dff5dc",
    cheek: "#9be1ad",
    mouth: "#0d4f45",
    throat: "#8fd6a2"
  },
  con: {
    body: "#d45f7a",
    shade: "#a03d56",
    belly: "#fde2ea",
    cheek: "#f4b4c4",
    mouth: "#7a2a3d",
    throat: "#f0a4b8"
  },
  judge: {
    body: "#9978b8",
    shade: "#6d5390",
    belly: "#ece4f5",
    cheek: "#c8b8dd",
    mouth: "#3f2f55",
    throat: "#c3aede"
  }
};

interface TheaterFrogProps extends SVGProps<SVGSVGElement> {
  mood: TheaterFrogMood;
  /** When true, the mouth chatters and the throat sac pulses. */
  speaking?: boolean;
  expression?: TheaterFrogExpression;
  size?: number;
}

/** Resting mouth per mood, with expression overrides. */
function mouthPath(mood: TheaterFrogMood, expression: TheaterFrogExpression): string {
  if (expression === "smug") return "M46 53 q16 4 30 -6";
  if (expression === "proud") return "M42 48 q18 14 36 0";
  if (mood === "judge") return "M46 52 L74 52";
  if (mood === "con") return "M44 54 q16 -9 32 0";
  return "M44 50 q16 11 32 0";
}

export function TheaterFrog({
  mood,
  speaking = false,
  expression = "idle",
  size = 120,
  className,
  ...rest
}: TheaterFrogProps) {
  const c = palette[mood];
  const judge = mood === "judge";
  const composed = ["theater-frog", speaking ? "is-speaking" : "", className]
    .filter(Boolean)
    .join(" ");
  const eyeClass = `theater-frog-eye${expression === "squint" ? " is-squint" : ""}`;
  const pupilClass = `theater-frog-pupil${
    expression === "dart" ? " is-dart" : expression === "think" ? " is-think" : ""
  }`;

  return (
    <svg
      viewBox="0 0 120 104"
      width={size}
      height={size * (104 / 120)}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={composed}
      {...rest}
    >
      {/* haunches */}
      <ellipse cx="26" cy="76" rx="17" ry="13" fill={c.shade} />
      <ellipse cx="94" cy="76" rx="17" ry="13" fill={c.shade} />
      {/* body */}
      <ellipse cx="60" cy="64" rx="35" ry="31" fill={c.body} />
      {/* throat sac — sits between body and belly so inflation reads at the chin */}
      <circle
        className="theater-frog-throat"
        cx="60"
        cy="72"
        r="10"
        fill={c.throat}
        style={{ transformOrigin: "60px 72px" }}
      />
      {/* belly */}
      <ellipse cx="60" cy="76" rx="23" ry="17" fill={c.belly} />
      {judge ? (
        <>
          {/* robe and collar */}
          <path d="M38 60 q22 15 44 0 v30 q-22 9 -44 0z" fill="#352641" opacity="0.9" />
          <path d="M47 59 l13 13 l13 -13 l-7 28 h-12z" fill="#fffdf2" opacity="0.95" />
        </>
      ) : null}
      {/* head */}
      <ellipse cx="60" cy="40" rx="33" ry="25" fill={c.body} />
      {/* soft highlight */}
      <ellipse cx="50" cy="30" rx="20" ry="10" fill="#ffffff" opacity="0.12" />
      {judge ? (
        <>
          {/* judge's wig */}
          <path
            d="M30 24 q30 -18 60 0 q-7 7 -15 5 q-8 -4 -15 0 q-8 2 -15 -1 q-9 2 -15 -4z"
            fill="#fffdf2"
          />
          <circle cx="30" cy="30" r="6" fill="#fffdf2" />
          <circle cx="90" cy="30" r="6" fill="#fffdf2" />
        </>
      ) : null}
      {/* eye bumps */}
      <circle cx="40" cy="20" r="11" fill={c.body} />
      <circle cx="80" cy="20" r="11" fill={c.body} />
      {/* eyes — separate groups so each blinks on its own cadence; the
          pupil is its own group so it can dart or drift independently */}
      <g className={eyeClass} style={{ transformOrigin: "40px 18px" }}>
        <circle cx="40" cy="18" r="8" fill="#fffdf2" />
        <g className={pupilClass}>
          <circle cx="41" cy="18" r="3.4" fill="#221a10" />
          <circle cx="42.4" cy="16.6" r="1.2" fill="#fffdf2" />
        </g>
      </g>
      <g className={eyeClass} style={{ transformOrigin: "80px 18px", animationDelay: "0.25s" }}>
        <circle cx="80" cy="18" r="8" fill="#fffdf2" />
        <g className={pupilClass}>
          <circle cx="79" cy="18" r="3.4" fill="#221a10" />
          <circle cx="80.4" cy="16.6" r="1.2" fill="#fffdf2" />
        </g>
      </g>
      {/* cheeks */}
      <circle cx="32" cy="46" r="4.6" fill={c.cheek} opacity="0.8" />
      <circle cx="88" cy="46" r="4.6" fill={c.cheek} opacity="0.8" />
      {/* nostrils */}
      <circle cx="55" cy="33" r="1.4" fill={c.mouth} />
      <circle cx="65" cy="33" r="1.4" fill={c.mouth} />
      {/* mouth — resting shape per mood/expression, plus the chattering
          open shape */}
      <g style={{ transformOrigin: "60px 52px" }}>
        <path
          d={mouthPath(mood, expression)}
          stroke={c.mouth}
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
        <ellipse
          className="theater-frog-mouth-open"
          cx="60"
          cy="55"
          rx="10"
          ry="7.5"
          fill={c.mouth}
          style={{ transformOrigin: "60px 55px" }}
        />
      </g>
      {/* front feet */}
      <ellipse cx="42" cy="93" rx="13" ry="5.5" fill={c.shade} />
      <ellipse cx="78" cy="93" rx="13" ry="5.5" fill={c.shade} />
    </svg>
  );
}
