import { beforeEach, describe, expect, it, vi } from "vitest";
import { readDebateHistory, rememberDebate } from "@/lib/debate-history";
const seed = { id: "debate_one", subject: "A question?", status: "queued" as const, createdAt: "2026-11-13T12:00:00Z" };
beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
describe("browser debate history", () => {
  it("updates an existing entry without duplicating it or changing its date", () => {
    rememberDebate(seed);
    rememberDebate({ ...seed, status: "complete", createdAt: "2026-11-14T12:00:00Z" });
    expect(readDebateHistory()).toEqual([{ ...seed, status: "complete" }]);
  });
  it("keeps the newest 50 entries", () => {
    for (let n = 0; n < 55; n++) rememberDebate({ ...seed, id: `debate_${n}`, createdAt: new Date(1700000000000 + n * 1000).toISOString() });
    const history = readDebateHistory();
    expect(history).toHaveLength(50);
    expect(history[0].id).toBe("debate_54");
    expect(history[49].id).toBe("debate_5");
  });
  it("ignores corrupt storage and malformed entries", () => {
    localStorage.setItem("debatefrog:history:v1", "not json");
    expect(readDebateHistory()).toEqual([]);
    localStorage.setItem("debatefrog:history:v1", JSON.stringify([null, {}, seed, seed, { ...seed, id: "../unsafe" }]));
    expect(readDebateHistory()).toEqual([seed]);
  });
  it("reports storage failure instead of claiming a debate was saved", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(rememberDebate(seed)).toBe(false);
  });
});
