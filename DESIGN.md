---
name: DebateFrog
description: The existing pond theater and its question-entry welcome surface.
colors:
  pond: "#0d4f45"
  leaf: "#44a15f"
  berry: "#d45f7a"
  judge: "#9978b8"
  mint: "#dff5dc"
  cream: "#fff7dd"
  panel: "#fffdf2"
  ink: "#182320"
  mud: "#5f4a38"
  sun: "#f4c95d"
  welcome-highlight: "#f3cf95"
  welcome-hover: "#176956"
  welcome-disabled: "#d8dfd0"
  welcome-disabled-text: "#4b5c50"
  field: "#fffef9"
  field-border: "#aca99a"
  field-placeholder: "#656b60"
  suggestion-active: "#edf3e5"
  error: "#982f48"
  environment-dark: "#10262e"
  environment-mid: "#14333c"
  environment-light: "#1b4450"
typography:
  display:
    fontFamily: 'ui-rounded, "Avenir Next", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "40px"
    fontWeight: 900
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  title:
    fontFamily: 'ui-rounded, "Avenir Next", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "22px"
    fontWeight: 900
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  body:
    fontFamily: 'ui-rounded, "Avenir Next", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "15px"
    lineHeight: 1.65
  input:
    fontFamily: 'ui-rounded, "Avenir Next", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "16px"
    lineHeight: 1.5
  button:
    fontFamily: 'ui-rounded, "Avenir Next", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "15px"
    fontWeight: 800
rounded:
  welcome-control: "9px"
  panel: "16px"
  welcome-scene: "22px"
  pill: "999px"
spacing:
  control-gap: "12px"
  page-gutter: "16px"
  welcome-column-gap: "32px"
components:
  welcome-start:
    backgroundColor: "{colors.pond}"
    textColor: "{colors.cream}"
    typography: "{typography.button}"
    rounded: "{rounded.welcome-control}"
    padding: "12px 16px"
    width: "100%"
  welcome-start-hover:
    backgroundColor: "{colors.welcome-hover}"
  welcome-start-disabled:
    backgroundColor: "{colors.welcome-disabled}"
    textColor: "{colors.welcome-disabled-text}"
  question-field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    typography: "{typography.input}"
    rounded: "{rounded.welcome-control}"
    padding: "13px"
  question-panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "25px"
---

# Design System: DebateFrog

## Overview

**Creative North Star: "The existing pond theater"**

Question entry is the entrance to the existing pond theater. Dark teal surroundings, a dusk sky, familiar frogs, and a parchment form connect the welcome and debate views. The operating task is choosing a question and starting a debate, with plain language suitable for a 10-year-old.

This is a record of the implemented identity and welcome refinement, not a replacement brand. Sources: `src/app/globals.css`, `tailwind.config.ts`, `froglings-hero.tsx`, `froglings-workspace.tsx`, `pond-theater.tsx`, and `theater-frog.tsx`. Surface direction lives in `docs/design/landing.md`. This product presentation belongs in Debatefrog; reusable debate execution remains in Polyvise Core.

**Key Characteristics:**

- Existing green YES frog, pink NO frog, and purple judge SVGs.
- Rounded system typography, bold headings, and warm light surfaces.
- A usable question form near the top on desktop and phones.

## Colors

Pond green anchors controls; cream and parchment keep text and entry surfaces distinct from the dark teal environment.

- Primary: `pond` for the form label, enabled action, and focus outline; `leaf` for the YES frog.
- Secondary: `berry` for the NO frog and `judge` for the judge. Preserve the fuller character palettes in the existing SVG implementation.
- Neutrals: `panel` for parchment, `cream` for text on the scene, and `ink` for text in the form. `mud`, `mint`, and `sun` remain existing supporting app colors.
- Welcome states: `welcome-highlight` accents the last headline line; field, disabled, suggestion, and error tokens describe their named states. The environment tokens are the three stops of the existing dark teal page gradient.

## Typography

Use the rounded system stack recorded above. It lists available fonts and fallbacks; it does not promise a bundled font asset. Welcome display, form title, body, input, and button roles use the extracted values. Existing theater plaques and verdict rulings also use italic Georgia/Times New Roman; this accent does not replace welcome typography.

At the welcome breakpoint (760px), display text becomes 32px with 1.13 line height, the form title becomes 21px, and intro copy becomes 14px. At 420px, the display becomes 29px. Input text stays 16px.

## Layout

The workspace is centered at a maximum width of 960px with 16px horizontal gutters. The welcome scene places introduction and cast beside a 380px form column, with a 32px gap and 40px 32px 30px padding. Intro copy is limited to 32ch.

At 760px and below, the scene stacks introduction, form, and cast; padding becomes 24px 20px and copy may reach 38ch. At 420px, scene padding becomes 22px 14px and form padding becomes 18px. These are welcome-specific arrangements, not a requirement for every screen. Header controls wrap and retain at least 44px height.

## Elevation & Depth

The existing dusk gradient, moon, hills, reeds, water, and lily pads provide depth. Soft shadows separate the scene from the page and the parchment form from the scenery. Exact scene and form shadows are recorded in the sidecar; the existing `lily` and `pop` Tailwind shadows remain available elsewhere.

## Shapes

The welcome scene and parchment panel have softly rounded corners. Controls use the smaller welcome radius; header controls use pills. Existing dialogue bubbles use asymmetric corners and tails. Keep frog silhouettes, lily pads, and scenery in their existing SVG/CSS components.

## Components

- **Question panel:** parchment containing a visible label, vertically resizable textarea, full-width action, and five suggested questions. Field focus uses a pond border and a 2px outline offset by 2px.
- **Start action:** minimum 48px height. Hover darkens the green; disabled state uses muted green-gray. Submission changes the label and shows a spinner. The action is disabled while submitting or when trimmed input has fewer than four characters.
- **Suggestions:** full-width text buttons with dividers, minimum 44px height, and a pale green hover/selected background. Selection fills the question field; `aria-pressed` exposes the choice. Form buttons use a 2px pond focus outline offset by 3px.
- **Navigation:** existing pill controls for view mode and stats plus a circular sound button. Welcome focus uses the warm highlight color. Preserve their current functions and wrapping behavior.
- **Cast and scenery:** reuse `TheaterFrog`, `LilyPad`, and `PondScenery`. Welcome scenery uses deterministic positions and disables scenery animation; reduced-motion styles also suppress the existing frog eye and theater animations. Scenery is hidden from assistive technology. The cast retains visible role names and short descriptions. No generated raster assets are used.

## Do's and Don'ts

- Do reuse TheaterFrog, LilyPad, and PondScenery for continuity with the debate.
- Do retain visible focus, labeled fields, and readable submission and error states.
- Do keep welcome scenery static and preserve reduced-motion support.
- Don't replace the established pond identity or font stack for this refinement.
- Don't add generated raster assets when the existing SVG scenery and characters serve the surface.
- Don't let decorative content push question entry below a long introduction.
