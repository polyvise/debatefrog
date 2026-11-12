/** Keep the completed round visible while generation continues independently. */
export const ROUND_HOLD_MS = 6000;

/** Fifty words is a typical statement within our 30–60-word prompt target.
 * Add reading time for each longer statement; a short reply doesn't cancel it.
 */
export function roundReadingHoldMs(statements: readonly string[]): number {
  const extraWords = statements.reduce((total, statement) => {
    const wordCount = statement.trim().match(/\S+/g)?.length ?? 0;
    return total + Math.max(0, wordCount - 50);
  }, 0);
  return ROUND_HOLD_MS + Math.ceil(extraWords / 5) * 1000;
}
