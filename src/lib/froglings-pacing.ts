/** Keep the completed round visible while generation continues independently. */
export const ROUND_HOLD_MS = 8000;

/** Keep extra reading time for statements longer than fifty words.
 * Add reading time for each longer statement; a short reply doesn't cancel it.
 */
export function roundReadingHoldMs(statements: readonly string[]): number {
  const extraWords = statements.reduce((total, statement) => {
    const wordCount = statement.trim().match(/\S+/g)?.length ?? 0;
    return total + Math.max(0, wordCount - 50);
  }, 0);
  return ROUND_HOLD_MS + Math.ceil(extraWords / 5) * 1000;
}
