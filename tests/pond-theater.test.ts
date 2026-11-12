import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoundTurn } from "@polyvise/core/debate/types";
import { PondTheater } from "@/components/pond-theater";
import type { FroglingsLiveState } from "@/components/froglings-workspace";
import { froglingsBubbleText, froglingsTheaterCaption } from "@/lib/froglings-text";
import { roundReadingHoldMs } from "@/lib/froglings-pacing";

describe("reading time", () => {
  it.each([
    [0, 0, 6000],
    [50, 50, 6000],
    [51, 50, 7000],
    [60, 60, 10000],
    [80, 20, 12000]
  ])("gives %i- and %i-word statements a %ims pause", (proWords, conWords, expectedMs) => {
    expect(roundReadingHoldMs(["word\n ".repeat(proWords), "word ".repeat(conWords)])).toBe(expectedMs);
  });
});

function turn(side: "pro" | "con", content: string, round: RoundTurn["round"] = "opening"): RoundTurn {
  return {
    id: `${round}-${side}`, round, side, content,
    agentId: side, agentName: `${side} frog`, claimIds: [], sourceIds: [],
    createdAt: "2026-11-11T00:00:00Z"
  };
}

function live(turns: RoundTurn[], debateId = "test-debate"): FroglingsLiveState {
  return {
    debateId, subject: "Should schools have longer recess?", status: "debating",
    teams: null, claims: [], sources: [], turns, scorecard: null, summary: null,
    errorMessage: null, backupReasons: [], modelSnapshots: [], trace: [], done: false
  };
}

describe("complete frog statements", () => {
  it("preserves long sentences, decimals, and the final sentence in every view", () => {
    const content = "A 49.8 percent result needs careful explanation, " +
      "including how the school measured changes in attention and whether students had enough time to play outside before returning to their classroom. " +
      "Teachers also need time to plan lessons around the new schedule so that students still have enough time for reading, math, science, and art. " +
      "Try the change for one term before deciding.";
    const statement = turn("pro", content);
    expect(froglingsTheaterCaption(statement)).toBe(content);
    expect(froglingsBubbleText(statement)).toBe(content);
  });
});

describe("pond theater playback", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function render(state: FroglingsLiveState) {
    act(() => root.render(createElement(PondTheater, { live: state })));
  }

  function advance(ms: number) {
    act(() => vi.advanceTimersByTime(ms));
  }

  function text(side: "pro" | "con") {
    return container.querySelector(`.pt-bubble-${side} .pt-bubble-text > span:not(.pt-bubble-reserve)`)?.textContent;
  }

  it("keeps preparation visible until YES can speak, then clears props on speech or failure", () => {
    const state = { ...live([]), status: "researching" as const };
    render(state);
    expect(container.querySelectorAll(".frog-research-kit")).toHaveLength(2);
    expect(container.querySelector(".pt-pad-pro .frog-research-glass")).not.toBeNull();
    expect(container.querySelector(".pt-pad-con .frog-research-pencil")).not.toBeNull();
    expect(container.querySelector(".pt-pad-judge .frog-research-kit")).toBeNull();
    render({ ...state, status: "debating" });
    expect(container.querySelectorAll(".frog-research-kit")).toHaveLength(2);
    expect(container.querySelector(".pt-bubble-thinking")).toBeNull();
    expect(container.querySelector(".pt-plaque")?.textContent).toContain("Preparing the opening statements");
    render(live([turn("pro", "Yes.")]));
    expect(container.querySelector(".frog-research-kit")).toBeNull();
    render(state);
    expect(container.querySelectorAll(".frog-research-kit")).toHaveLength(2);
    render({ ...state, status: "failed", done: true });
    expect(container.querySelector(".frog-research-kit")).toBeNull();
  });

  it("finishes both statements, holds for six seconds, and buffers arriving turns", () => {
    const pro = turn("pro", "More time outside helps children concentrate. ".repeat(8).trim());
    const con = turn("con", "We also need enough time for lessons. ".repeat(7).trim());
    const next = turn("pro", "How would the schedule change?", "cross_examination");
    render(live([pro, con]));
    advance(pro.content.length * 20 - 20);
    expect(text("pro")).toBe(pro.content.slice(0, -1));
    expect(text("con")).toBeUndefined();
    expect(container.querySelector('[role="timer"]')).toBeNull();
    advance(20);
    expect(text("pro")).toBe(pro.content);
    advance(con.content.length * 20);
    expect(text("con")).toBe(con.content);
    expect(container.querySelector('[role="timer"]')?.textContent).toBe("Next round in 6s");

    advance(3000);
    render(live([pro, con, next]));
    expect(container.querySelector('[role="timer"]')?.textContent).toBe("Next round in 3s");
    expect(container.querySelector(".pt-plaque")?.textContent).toContain("Round 1");
    expect(text("pro")).toBe(pro.content);
    expect(text("con")).toBe(con.content);
    advance(2999);
    expect(container.querySelector(".pt-plaque")?.textContent).toContain("Round 1");
    advance(1);
    expect(container.querySelector(".pt-plaque")?.textContent).toContain("Round 2");
    expect(container.querySelector('[role="timer"]')).toBeNull();
    advance(next.content.length * 20);
    expect(text("pro")).toBe(next.content);
  });

  it("extends the visible countdown for a long statement and holds arriving rounds until it ends", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    const pro = turn("pro", Array(80).fill("word").join(" ") + ".");
    const con = turn("con", Array(20).fill("word").join(" ") + ".");
    render(live([pro, con]));
    expect(container.querySelector('[role="timer"]')?.textContent).toBe("Next round in 12s");
    advance(6000);
    const next = turn("pro", "Next round.", "cross_examination");
    render(live([pro, con, next]));
    expect(container.querySelector('[role="timer"]')?.textContent).toBe("Next round in 6s");
    expect(text("pro")).toBe(pro.content);
    advance(5999);
    expect(container.querySelector(".pt-plaque")?.textContent).toContain("Round 1");
    advance(1);
    expect(text("pro")).toBe(next.content);
    expect(container.querySelector(".pt-plaque")?.textContent).toContain("Round 2");
  });

  it("keeps next-round thinking hidden until the reading pause ends", () => {
    render(live([turn("pro", "Yes."), turn("con", "No.")]));
    advance(80);
    advance(60);
    advance(5999);
    expect(container.querySelector(".pt-bubble-thinking")).toBeNull();
    advance(1);
    expect(container.querySelector(".pt-bubble-thinking")?.textContent).toContain("Yes Frog");
  });

  it("keeps the reading pause when reduced motion skips typing", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    render(live([turn("pro", "Yes."), turn("con", "No.")]));
    expect(text("pro")).toBe("Yes.");
    expect(text("con")).toBe("No.");
    advance(5999);
    expect(container.querySelector(".pt-plaque")?.textContent).toContain("Round 1");
    advance(1);
    expect(container.querySelector(".pt-plaque")?.textContent).toContain("Round 2");
  });

  it("cancels the old round's advance when a new debate starts", () => {
    render(live([turn("pro", "Yes."), turn("con", "No.")]));
    advance(80);
    advance(60);
    advance(1000);
    render(live([], "new-debate"));
    expect(container.querySelector('[role="timer"]')).toBeNull();
    advance(6000);
    expect(container.querySelector(".pt-plaque")?.textContent).toContain("Preparing the opening statements");
  });

  it("shows a thought bubble and a still judge mouth after the closing pause", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    const rounds = ["opening", "cross_examination", "rebuttal", "closing"] as const;
    const state = live(rounds.flatMap((round) => [turn("pro", "Yes.", round), turn("con", "No.", round)]));
    state.status = "judging";
    render(state);
    for (let index = 0; index < 3; index++) advance(6000);
    advance(5999);
    expect(container.querySelector(".judge-thought-bubble")).toBeNull();
    advance(1);
    expect(container.querySelector(".pt-pad-judge .judge-thought-bubble")?.textContent).toContain("Weighing both sides");
    expect(container.querySelector(".pt-pad-judge .theater-frog.is-speaking")).toBeNull();
    expect(container.querySelector(".pt-pad-judge .theater-frog-pupil.is-think")).not.toBeNull();
    render({ ...state, status: "complete", done: true,
      scorecard: { recommendation: "lean_yes", confidence: 0.7, categories: [] },
      summary: { headline: "YES wins", recommendation: "Try it.", strongestPro: [], strongestCon: [], unresolvedUncertainties: [], whatWouldChangeMind: [], confidence: 0.7 }
    });
    expect(container.querySelector(".judge-thought-bubble")).toBeNull();
    expect(container.querySelector(".pt-verdict-scene")).not.toBeNull();
  });

  it("holds the closing statements before revealing an already generated verdict", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    const rounds = ["opening", "cross_examination", "rebuttal", "closing"] as const;
    const state = live(rounds.flatMap((round) => [turn("pro", "Yes.", round), turn("con", "No.", round)]));
    state.status = "complete";
    state.done = true;
    state.scorecard = { recommendation: "lean_yes", confidence: 0.7, categories: [] };
    state.summary = {
      headline: "YES wins", recommendation: "Try a longer break.", strongestPro: [],
      strongestCon: [], unresolvedUncertainties: [], whatWouldChangeMind: [], confidence: 0.7
    };
    render(state);
    for (let index = 0; index < 3; index++) advance(6000);
    expect(container.querySelector('[role="timer"]')?.textContent).toBe("Judge’s turn in 6s");
    advance(5999);
    expect(container.querySelector(".pt-plaque")?.textContent).toContain("Round 4");
    expect(text("pro")).toBe("Yes.");
    expect(text("con")).toBe("No.");
    expect(container.querySelector(".pt-verdict-scene")).toBeNull();
    advance(1);
    expect(container.querySelector(".pt-verdict-scene")).not.toBeNull();
  });
});
