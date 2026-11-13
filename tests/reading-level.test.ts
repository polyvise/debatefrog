import { afterEach, expect, it, vi } from "vitest";
import { readReadingLevel, saveReadingLevel } from "@/lib/reading-level";
import { debatefrogRequestSchema } from "@/server/debate-request";
import { semanticOutputIssues, withDebatefrogGenerationRules } from "@/server/round-model-provider";

afterEach(() => { window.localStorage.clear(); vi.restoreAllMocks(); });
it("defaults to younger readers and remembers a valid selection", () => {
  expect(readReadingLevel()).toBe("9-11");
  saveReadingLevel("12-14");
  expect(readReadingLevel()).toBe("12-14");
  window.localStorage.setItem("debatefrog-reading-level", "adult");
  expect(readReadingLevel()).toBe("9-11");
});
it("works when browser storage is blocked", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error(); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error(); });
  expect(readReadingLevel()).toBe("9-11");
  expect(() => saveReadingLevel("12-14")).not.toThrow();
});
it("rejects unknown reading levels at the API boundary", () => {
  expect(debatefrogRequestSchema.safeParse({ subject: "Should homework be banned?", readingLevel: "adult" }).success).toBe(false);
});
it.each(["claimOutput", "debateTurnOutput", "judgeScorecardOutput", "finalSummaryOutput", "followupOutput"])("uses the older audience for %s", schemaName => {
  const request = { role: "judge", schemaName, prompt: JSON.stringify({ round: "opening" }) };
  const prompt = withDebatefrogGenerationRules(request, "12-14").prompt;
  expect(prompt).toContain("13-year-old");
  expect(prompt).toContain("grade 7");
  expect(prompt).toContain("tradeoffs");
  expect(prompt).not.toContain("10-year-old");
  expect(prompt).not.toContain("${policy");
  if (schemaName === "followupOutput") expect(prompt).toContain("30-60 words");
});
it("matches repair limits to the selected audience", () => {
  const output = { turns: [{ round: "opening", content: `${"word ".repeat(39)}done.`, sourceIds: [] }] };
  expect(semanticOutputIssues("debateTurnOutput", output, "{}", "9-11").join()).toContain("10-year-old");
  expect(semanticOutputIssues("debateTurnOutput", output, "{}", "12-14")).toEqual([]);
});
