export const readingLevels = ["9-11", "12-14"] as const;
export type ReadingLevel = (typeof readingLevels)[number];
export const DEFAULT_READING_LEVEL: ReadingLevel = "9-11";
const STORAGE_KEY = "debatefrog-reading-level";
export function isReadingLevel(value: unknown): value is ReadingLevel {
  return value === "9-11" || value === "12-14";
}
export function readReadingLevel(): ReadingLevel {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isReadingLevel(value) ? value : DEFAULT_READING_LEVEL;
  } catch { return DEFAULT_READING_LEVEL; }
}
export function saveReadingLevel(value: ReadingLevel): void {
  try { window.localStorage.setItem(STORAGE_KEY, value); } catch { /* Selection still works without storage. */ }
}
export function audiencePolicy(level: ReadingLevel = DEFAULT_READING_LEVEL) {
  return level === "12-14"
    ? { age: 13, grade: 7, sentence: "8-16", turn: "30-50", turnMax: 50, question: "10-20", questionMax: 25, summary: "20-40", summaryMax: 40, itemMax: 20, followup: "30-60" }
    : { age: 10, grade: 4, sentence: "6-12", turn: "20-35", turnMax: 35, question: "8-15", questionMax: 20, summary: "15-30", summaryMax: 30, itemMax: 15, followup: "20-45" };
}
