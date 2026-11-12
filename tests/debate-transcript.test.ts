import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EvidenceSource, RoundTurn } from "@polyvise/core/debate/types";
import { DebateTranscript } from "@/components/debate-transcript";

const source = (id: string, overrides: Partial<EvidenceSource> = {}): EvidenceSource => ({
  id, title: `Research about homework and learning from ${id}`, url: `https://research.example.edu/${id}`,
  publisher: "School Research Lab", snippet: "Research findings.", quality: "primary", retrievedVia: "tavily", status: "accepted", ...overrides
});
const turn = (id: string, sourceIds: string[], side: "pro" | "con" = "pro"): RoundTurn => ({
  id, round: "opening", agentId: side, agentName: side, side, content: `My point ${id}.`, sourceIds, claimIds: [], createdAt: "2026-11-12T00:00:00Z"
});
function render(sources: EvidenceSource[], turns: RoundTurn[]) {
  const node = document.createElement("div");
  node.innerHTML = renderToStaticMarkup(createElement(DebateTranscript, { sources, turns }));
  return node;
}

describe("transcript sources", () => {
  it("links every citation to its own point, including citations beyond the live two-link limit", () => {
    const sources = [source("one"), source("two"), source("three")];
    const node = render(sources, [turn("a", ["one", "two", "three"]), turn("b", ["two"], "con")]);
    const points = node.querySelectorAll("article ul");
    expect(Array.from(points[0].querySelectorAll("a"), link => link.href)).toEqual(sources.map(s => s.url));
    expect(Array.from(points[1].querySelectorAll("a"), link => link.href)).toEqual([sources[1].url]);
    for (const link of node.querySelectorAll("a")) {
      expect(link.target).toBe("_blank");
      expect(link.rel).toContain("noopener");
      expect(link.textContent).toContain("opens in a new tab");
    }
  });

  it("lists cited sources once by URL with full titles, excluding unused or hidden sources", () => {
    const sources = [source("one"), source("duplicate", { url: "https://research.example.edu/one/" }), source("unused"),
      source("rejected", { status: "rejected" }), source("unsafe", { url: "javascript:alert(1)" }),
      source("internal", { publisher: "Internal reference", retrievedVia: "mock", quality: "methodology" })];
    const node = render(sources, [turn("a", ["one", "duplicate", "missing", "rejected", "unsafe", "internal"]), turn("b", ["one"], "con")]);
    const references = node.querySelector('section[aria-label="Sources used"]')!;
    expect(references.querySelectorAll("a")).toHaveLength(1);
    expect(references.textContent).toContain(sources[0].title);
    expect(references.textContent).toContain("School Research Lab");
    expect(node.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(node.textContent).not.toContain(sources[2].title);
    expect(node.textContent).not.toContain("Internal reference");
  });

  it("keeps uncited points readable and explains a missing source list", () => {
    const node = render([], [turn("a", ["missing"])]);
    expect(node.querySelector("summary")?.textContent).toBe("Read the whole debate");
    expect(node.textContent).toContain("My point a.");
    expect(node.textContent).toContain("No linked sources were saved for these points.");
    expect(node.querySelectorAll("a")).toHaveLength(0);
  });
});
