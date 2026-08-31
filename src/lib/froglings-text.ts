/**
 * Shared kid-friendly text + turn-ordering helpers for the froglings UIs.
 *
 * Extracted from froglings-workspace.tsx so both renderers — the classic
 * card view (FroglingsLive) and the pond theater (PondTheater) — can use
 * the same simplification pipeline without importing each other.
 */

import type {
  DebateRound,
  DebateStatus,
  DebateSummary,
  RoundTurn,
  Scorecard,
  TopicKind
} from "@polyvise/core/debate/types";

/**
 * Plain-language stage labels for younger readers. The engine emits the
 * same DebateStatus values as the engine — we just rename them.
 */
export const friendlyStage: Record<DebateStatus, string> = {
  queued: "the frogs are getting ready",
  framing: "the frogs are reading the question",
  researching: "the frogs are looking up facts",
  debating: "the frogs are debating",
  judging: "the judge frog is thinking",
  complete: "debate finished",
  failed: "uh oh - the frogs slipped off the lily pad",
  partial: "uh oh - the frogs slipped off the lily pad"
};

/**
 * Plain-language round labels. Matches DebateRound from the engine.
 */
export const friendlyRound: Record<DebateRound, { title: string; blurb: string }> = {
  opening: {
    title: "Round 1 — Opening",
    blurb: "Each frog says what they think."
  },
  cross_examination: {
    title: "Round 2 — Tough Questions",
    blurb: "Each frog asks the other tricky questions."
  },
  rebuttal: {
    title: "Round 3 — Comeback",
    blurb: "Each frog answers back to defend their side."
  },
  closing: {
    title: "Round 4 — Last Word",
    blurb: "Each frog says why they should win."
  },
  judge_review: {
    title: "Judge's Notes",
    blurb: "The judge frog jots down what stood out."
  },
  synthesis: {
    title: "Wrap-up",
    blurb: "Putting it all together."
  }
};

export function orderedFroglingsTurns(turns: RoundTurn[]) {
  const roundOrder: DebateRound[] = ["opening", "cross_examination", "rebuttal", "closing"];
  const sideOrder = { pro: 0, con: 1, neutral: 2 };
  return [...turns]
    .filter((turn) => roundOrder.includes(turn.round))
    .sort((a, b) => {
      const roundDiff = roundOrder.indexOf(a.round) - roundOrder.indexOf(b.round);
      if (roundDiff !== 0) return roundDiff;
      return sideOrder[a.side] - sideOrder[b.side];
    });
}

export function hasAllDebateTurns(turns: RoundTurn[]) {
  const debateTurns = orderedFroglingsTurns(turns);
  const rounds = new Set(debateTurns.map((turn) => turn.round));
  const hasBothSidesByRound = ["opening", "cross_examination", "rebuttal", "closing"].every((round) => {
    const turnsForRound = debateTurns.filter((turn) => turn.round === round);
    return turnsForRound.some((turn) => turn.side === "pro") && turnsForRound.some((turn) => turn.side === "con");
  });
  return rounds.size >= 4 && hasBothSidesByRound;
}

export function nextExpectedFrogSide(turns: RoundTurn[]): "pro" | "con" {
  const count = orderedFroglingsTurns(turns).length;
  return count % 2 === 0 ? "pro" : "con";
}

export function froglingsBubbleText(turn: RoundTurn) {
  const text = simplifyForKids(stripSpeakerPrefix(turn.content, turn.agentName));
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((sentence) => sentence.trim()) ?? [text];
  const picked: string[] = [];

  for (const sentence of sentences) {
    if (!sentence) continue;
    const next = [...picked, sentence].join(" ");
    if (picked.length >= 2 || next.length > 300) break;
    picked.push(sentence);
  }

  const compressed = picked.length > 0 ? picked.join(" ") : text;
  return trimAtWord(compressed, 320);
}

export function stripSpeakerPrefix(content: string, agentName: string) {
  const escapedName = agentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return content
    .replace(new RegExp(`^${escapedName}:\\s*`, "i"), "")
    .replace(/^\w[\w\s-]{0,40}:\s*/, "");
}

export function simplifyForKids(content: string) {
  return content
    .replace(/\((?:claim|src)[^)]+\)/gi, "")
    .replace(/\bYou says that\b/g, "You said that")
    .replace(/\byou says that\b/g, "you said that")
    .replace(/\bYou says\b/g, "You said")
    .replace(/\byou says\b/g, "you said")
    .replace(/["“]Resolved:\s*([^"”]+?)\.?["”]/gi, (_match, question: string) => `"${froglingsQuestionText(question)}"`)
    .replace(/\bResolved:\s*/gi, "")
    .replace(/^The (?:YES side|affirmative) case for ["“][^"”]+["”]\s+(?:is grounded in|starts with (?:this claim|the claim that):?)\s*/i, "The green frog says ")
    .replace(/^The (?:YES side|affirmative) case .*? starts with (?:this claim|the claim that):?\s*/i, "The green frog says ")
    .replace(/^The (?:NO side|negative) case (?:against ["“][^"”]+["”]\s+)?(?:challenges the question by )?(?:asserting|saying|arguing):?\s*(?:that\s*)?/i, "The pink frog says ")
    .replace(/^The (?:NO side|negative) case challenges the question by (?:asserting|saying|arguing):?\s*/i, "The pink frog says ")
    .replace(/\bpro side's\b/gi, "YES side's")
    .replace(/\bcon side's\b/gi, "NO side's")
    .replace(/\bpro side\b/gi, "YES side")
    .replace(/\bcon side\b/gi, "NO side")
    .replace(/\bpro case\b/gi, "YES case")
    .replace(/\bcon case\b/gi, "NO case")
    .replace(/\bvote pro\b/gi, "vote YES")
    .replace(/\bvote con\b/gi, "vote NO")
    .replace(/\baffirmative\b/gi, "YES side")
    .replace(/\bnegative\b/gi, "NO side")
    .replace(/\bYES side side\b/gi, "YES side")
    .replace(/\bNO side side\b/gi, "NO side")
    .replace(/\bpro\b/gi, "YES")
    .replace(/\bcon\b/gi, "NO")
    .replace(/\basserts?\b/gi, "says")
    .replace(/\bindicates?\b/gi, "shows")
    .replace(/\bsubstantial\b/gi, "big")
    .replace(/\bimplementation of\b/gi, "using")
    .replace(/\bacademic achievement\b/gi, "school performance")
    .replace(/\blogistical challenges\b/gi, "planning problems")
    .replace(/\bresolution\b/gi, "question")
    .replace(/\bstudies shows\b/gi, "studies show")
    .replace(/\s+/g, " ")
    .trim();
}

export function froglingsQuestionText(input: string) {
  const cleaned = input
    .replace(/^Resolved:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/^should\b/i.test(cleaned)) return `${cleaned.replace(/[.!?]+$/, "")}?`;
  return cleaned.replace(/\.$/, "");
}

export function literalQuestionText(input: string) {
  return input.replace(/\s+/g, " ").trim();
}

export function froglingsFrogName(side: "pro" | "con") {
  return side === "pro" ? "Yes Frog" : "No Frog";
}

export function trimAtWord(content: string, maxLength: number) {
  if (content.length <= maxLength) return content;
  const slice = content.slice(0, maxLength).trim();
  const lastSpace = slice.lastIndexOf(" ");
  const trimmed = slice.slice(0, lastSpace > 180 ? lastSpace : maxLength).replace(/[,:;.-]+$/, "");
  return `${trimmed}.`;
}

export function froglingsVerdictCopy(scorecard: Scorecard, topicKind?: TopicKind, summary?: DebateSummary | null) {
  const summaryHeadline = summary?.headline ? simplifyForKids(summary.headline) : "";
  const summaryBody = summary?.recommendation ? simplifyForKids(summary.recommendation) : "";

  if (summaryHeadline && summaryBody) {
    return {
      headline: summaryHeadline,
      body: summaryBody
    };
  }

  const topicCopy = froglingsVerdictTopicCopy(topicKind);

  switch (scorecard.recommendation) {
    case "lean_yes":
      return {
        headline: "The judge gives this one to YES.",
        body: "The green frog made the stronger case, but the pink frog still raised some things to watch."
      };
    case "conditional_yes":
      return {
        headline: topicCopy.conditionalYesHeadline,
        body: topicCopy.conditionalYesBody
      };
    case "lean_no":
      return {
        headline: "The judge gives this one to NO.",
        body: "The pink frog made the stronger case, though the green frog had some good reasons too."
      };
    case "conditional_no":
      return {
        headline: topicCopy.conditionalNoHeadline,
        body: topicCopy.conditionalNoBody
      };
    case "mixed":
    default:
      return {
        headline: "The judge says this one is close.",
        body: "Both frogs made good points. The best answer depends on which reasons matter most."
      };
  }
}

export function froglingsVerdictTopicCopy(topicKind?: TopicKind) {
  switch (topicKind) {
    case "policy":
    case "decision":
      return {
        conditionalYesHeadline: "The judge says: probably YES, with care.",
        conditionalYesBody:
          "The green frog made the stronger case, but the idea would need clear rules and checks along the way.",
        conditionalNoHeadline: "The judge says: probably NO, unless things change.",
        conditionalNoBody:
          "The pink frog made the stronger case for now. Better evidence or a safer plan could change the answer."
      };
    case "empirical":
    case "comparison":
      return {
        conditionalYesHeadline: "The judge says: probably YES.",
        conditionalYesBody:
          "The green frog made the stronger case from the evidence shown, though the answer is not completely certain.",
        conditionalNoHeadline: "The judge says: probably NO.",
        conditionalNoBody:
          "The pink frog made the stronger case from the evidence shown, though the answer is not completely certain."
      };
    case "value":
    default:
      return {
        conditionalYesHeadline: "The judge says: probably YES.",
        conditionalYesBody:
          "The green frog made the stronger case, but the answer depends on which reasons matter most.",
        conditionalNoHeadline: "The judge says: probably NO.",
        conditionalNoBody:
          "The pink frog made the stronger case, but the answer depends on which reasons matter most."
      };
  }
}
