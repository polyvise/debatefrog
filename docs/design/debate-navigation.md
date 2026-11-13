# Debate navigation and history

Mode: Operate. Readers ages 9–14 can start another question, visit Pond stats, or reopen a debate without accidentally leaving their current work.

This extends the existing pond theater. Keep `DESIGN.md` and `.impeccable/design.json` as the incumbent visual system: pond green, parchment panels, rounded typography, pill actions, existing frog assets, and wrapping header controls. No new visual identity or assets are introduced.

## Navigation behavior

- The frog logo and DebateFrog name form one button with the same action as New question.
- Leaving an open debate or a nonempty question draft through the logo, New question, Pond stats, or a different history entry opens a native modal dialog. Opening My debates alone does not leave the current view.
- State the destination in the title and affirmative action. Use “No, stay here” for cancel and put initial focus there. Escape cancels; closing restores focus to the initiating control.
- Explain saved progress when a browser history entry was saved. If browser storage fails, say the debate could not be added to My debates. For an unstarted question, explain that leaving loses the draft.
- Keep the current debate visible until another saved debate loads successfully. Show loading and failure feedback within My debates.

## My debates

The header pill reveals an inline parchment panel above the current content. The list contains up to 50 debates remembered in this browser, newest first, with question, date, and a plain status. Opening an entry retrieves its saved record; the browser stores the list, not a full offline copy of the debate.

Keep the empty state, loading state, retrieval error, and browser-storage limitation explicit. Explain that other people using the same browser can see the list, clearing browser data removes it, and older debates from before this feature are not imported.

Use a bounded scrolling list with wrapping question text. Header and dialog actions retain at least 44px targets; rows have at least 64px height. The panel and dialog reuse parchment, pond-green headings and actions, mint hover states, and visible pond-green focus outlines. Header controls use a warm focus outline against the dark scene. Dialog actions wrap on narrow screens.

## Ownership and evidence

Debatefrog owns these navigation controls, age-appropriate copy, and browser persistence. History entries use Polyvise Core's `DebateRecord` fields and `debateStatuses`; reopening uses the app's existing record retrieval, hydration, and event watching. Generic execution and recovery remain in Core.

Implementation: `src/components/debate-navigation.tsx`, `src/components/froglings-workspace.tsx`, `src/lib/debate-history.ts`, and `src/app/globals.css`. Reviewed captures: `.impeccable/review/desktop.png`, `mobile.png` (360 × 780), `history-desktop.png`, `history-mobile.png`, and `header-focus.png`.
