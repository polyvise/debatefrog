import { afterEach, expect, it, vi } from "vitest";
import { readReadingLevel, saveReadingLevel } from "@/lib/reading-level";
import { debatefrogRequestSchema } from "@/server/debate-request";

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
