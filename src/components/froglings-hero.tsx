"use client";

import { isReadingLevel, type ReadingLevel } from "@/lib/reading-level";
import { useState, type FormEvent } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { TheaterFrog } from "@/components/theater-frog";
import { LilyPad, PondScenery } from "@/components/pond-theater";

const kidPrompts = [
  "Should schools have longer recess?",
  "Should kids be allowed to vote?",
  "Should video games count as exercise?",
  "Should pets be allowed at school?",
  "Should homework be banned?"
];
export function FroglingsHero({ subject, onSubjectChange, isSubmitting, error, onSubmit, readingLevel, onReadingLevelChange }: {
  readingLevel: ReadingLevel;
  onReadingLevelChange: (value: ReadingLevel) => void;
  subject: string;
  onSubjectChange: (value: string) => void;
  isSubmitting: boolean;
  error: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <section className="welcome-scene" aria-labelledby="welcome-title">
      <div className="welcome-scenery" aria-hidden="true"><PondScenery still /></div>
      <div className="welcome-intro">
        <h1 id="welcome-title">Two sides.{" "}<br />One judge.<br /><span>One big question.</span></h1>
        <p>One YES frog. One NO frog. A judge to weigh both sides. Bring a question and watch the debate unfold.</p>
      </div>
      <form className="welcome-form" onSubmit={onSubmit} aria-busy={isSubmitting}>
        <label htmlFor="subject">What should the frogs<br className="welcome-label-break" /> argue about?</label>
        <textarea id="subject" value={subject} onChange={event => onSubjectChange(event.target.value)}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          placeholder={focused ? "" : kidPrompts[0]} aria-describedby={error ? "welcome-error" : undefined} />
        <div className="welcome-reading-level">
          <label htmlFor="reading-level">Reading level</label>
          <select id="reading-level" value={readingLevel} disabled={isSubmitting}
            onChange={event => { if (isReadingLevel(event.target.value)) onReadingLevelChange(event.target.value); }}>
            <option value="9-11">Ages 9–11</option>
            <option value="12-14">Ages 12–14</option>
          </select>
        </div>
        {error ? <p id="welcome-error" className="welcome-error" role="alert">{error}</p> : null}
        <button className="welcome-start" type="submit" disabled={isSubmitting || subject.trim().length < 4}>
          {isSubmitting ? <>Getting the frogs ready <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /></> : <>Start the debate <ArrowRight className="h-4 w-4" aria-hidden="true" /></>}
        </button>
        <div className="welcome-suggestions">
          <p>Or try one of these</p>
          <div>{kidPrompts.map(prompt => <button type="button" key={prompt} disabled={isSubmitting} onClick={() => onSubjectChange(prompt)} aria-pressed={subject === prompt}>{prompt}<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></button>)}</div>
        </div>
      </form>
      <div className="welcome-cast" aria-label="Meet the frogs">
        {([['pro', 'YES frog', 'Makes the case'], ['judge', 'Judge frog', 'Weighs both sides'], ['con', 'NO frog', 'Challenges it']] as const).map(([mood, name, description]) => (
          <div className={`welcome-frog welcome-frog-${mood}`} key={mood}>
            <div className="welcome-frog-art" aria-hidden="true"><TheaterFrog mood={mood} /><LilyPad /></div>
            <p>{name}</p><span>{description}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
