import { describe, expect, it } from "vitest";
import type { EvidenceSource } from "@polyvise/core/debate/types";
import { buildFroglingsSourceChips } from "@/lib/source-chips";

describe("Debatefrog source chips", () => {
  it("shows live sources and hides deterministic methodology references", () => {
    const sources: EvidenceSource[] = [
      {
        id: "mock-method",
        title: "Debate methodology",
        url: "https://example.com/method",
        publisher: "Internal reference",
        snippet: "Methodology",
        quality: "methodology",
        retrievedVia: "mock",
        status: "accepted"
      },
      {
        id: "live-1",
        title: "Voting at 16",
        url: "https://example.edu/voting-at-16",
        publisher: "University Civic Lab",
        snippet: "Research on younger voters.",
        quality: "expert",
        retrievedVia: "tavily",
        status: "accepted"
      }
    ];

    expect(buildFroglingsSourceChips(["mock-method", "live-1"], sources)).toEqual([
      {
        id: "live-1",
        label: "University Civic Lab",
        url: "https://example.edu/voting-at-16"
      }
    ]);
  });
});
