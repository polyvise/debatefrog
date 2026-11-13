# Pond stats

Mode: Read. The page shows aggregate activity without exposing debate questions or answers.

Use the welcome page's dark teal background, frog wordmark, rounded typography, and parchment surfaces. Keep the header aligned with the 960px workspace. The page title sits directly on the dark background; totals share one divided panel, followed by the existing charts and output counts. Model bars use the judge frog's purple instead of yellow. Small labels use solid mud text on parchment, and navigation keeps the warm keyboard-focus outline.

At phone widths, totals become a two-by-two grid and chart panels stack. Preserve the existing stats source, calculations, labels, empty state, and unavailable state. This is DebateFrog presentation; no shared Core behavior changes.

Visual checks use local mock data, not production totals. Desktop and mobile captures are in `.impeccable/review/stats/`.

## Count definitions and verification

Each persisted debate is counted once by its latest saved status. Completed means `complete`; failed means `failed`; partial remains separate. A successful retry updates the same debate record, so past failed attempts are not counted again. Nonterminal statuses are described as unfinished, not currently active: an interrupted worker can leave an old queued record behind. The display does not rewrite those records or assume they failed.

Completion rate is completed / all debates. The 7-, 14-, and 30-day windows use UTC calendar days including today; future timestamps do not count as activity. Model usage counts a model once per debate, while token totals sum saved model snapshots. Source and turn totals come from saved runs; follow-ups and feedback come from their persisted collections. Preview and production currently use the same Firestore database and collections.

`python3 scripts/audit-pond-stats.py --project websites-prod-496602 --output /tmp/stats-audit.json` independently paginates Firestore through the authenticated local gcloud account. It is read-only and outputs aggregate results without questions, answers, IDs, or credentials. `node scripts/verify-pond-stats.mjs /tmp/stats-audit.json https://preview.debatefrog.com/stats` compares the deployed HTML with those audited values. Refresh the audit if live activity changes between reads.

On November 13, 2026 at 22:03 UTC, all 258 records parsed with unique IDs and valid timestamps: 217 completed, 40 failed, and 1 queued (84% completed). The queued record had not changed since May 21; this prompted the unfinished-label correction. No missing record fields, future creation dates, or record/run status mismatches were found. Regression tests cover all statuses, retries, empty data, UTC boundaries, model deduplication, and 1,001 records across repository pages.
