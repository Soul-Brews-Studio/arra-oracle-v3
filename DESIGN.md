# Design

## Source of truth
- Status: Draft
- Last refreshed: 2026-06-15
- Primary product surfaces: Frontend dashboard for menu and plugin discovery.
- Evidence reviewed: `web/src/pages/index.astro`, `web/src/styles/global.css`, `src/routes/menu/menu.ts`, `src/routes/plugins/model.ts`, `src/routes/plugins/list.ts`.

## Brand
- Personality: technical, calm, observability-first Oracle tooling.
- Trust signals: live API status, explicit loading/error/empty states, visible metadata.
- Avoid: decorative UI that hides operational state.

## Product goals
- Goals: show `/api/menu` navigation rows and `/api/plugins` registered plugin metadata quickly.
- Non-goals: editing menus/plugins, auth flows, or embedding the Astro marketing site.
- Success signals: frontend build passes; users can scan menu groups and plugin surfaces on desktop/mobile.

## Personas and jobs
- Primary personas: Oracle operators, plugin authors, maintainers.
- User jobs: confirm backend connectivity, inspect available navigation, inspect registered plugins/surfaces.
- Key contexts of use: local Vite dev proxy to `:47778`, same-origin deployed UI.

## Information architecture
- Primary navigation: in-page anchors for Overview, Menu, Plugins.
- Core routes/screens: single dashboard screen with two data panels.
- Content hierarchy: connection status, summary stats, menu viewer, plugin list.

## Design principles
- Principle 1: make live system state visible before details.
- Principle 2: prefer dense but readable operational cards.
- Tradeoffs: simple single-page UI over routing until more screens are required.

## Visual language
- Color: dark neutral base with teal/cyan Oracle accent and purple secondary accent.
- Typography: system sans for UI, mono for paths/commands.
- Spacing/layout rhythm: roomy mobile-first cards, two-column desktop panels.
- Shape/radius/elevation: rounded cards, subtle borders, low shadow.
- Motion: minimal hover/focus transitions only.
- Imagery/iconography: text badges over icon dependencies.

## Components
- Existing components to reuse: none in `frontend/`; visual cues borrowed from `web/src/styles/global.css`.
- New/changed components: status banner, stat cards, menu cards, plugin cards, badges.
- Variants and states: loading, error, empty, success.
- Token/component ownership: local Tailwind utility classes in `frontend/src/styles.css` and React components.

## Accessibility
- Target standard: semantic headings/sections and keyboard-visible controls.
- Keyboard/focus behavior: anchors/buttons keep browser focus styles enhanced by CSS.
- Contrast/readability: high-contrast dark theme with readable muted text.
- Screen-reader semantics: status text is plain text; sections use labelled headings.
- Reduced motion and sensory considerations: no required motion.

## Responsive behavior
- Supported breakpoints/devices: mobile single column, desktop two-column content grid.
- Layout adaptations: summary cards wrap; menu/plugin panels stack below large screens.
- Touch/hover differences: cards do not require hover-only controls.

## Interaction states
- Loading: pulse-style text placeholders.
- Empty: explicit empty cards for no menu/plugins.
- Error: retry button with error message.
- Success: updated timestamp and populated cards.
- Disabled: no disabled controls in this slice.
- Offline/slow network: fetch timeout is browser-managed; retry is available.

## Content voice
- Tone: concise, operational, transparent.
- Terminology: menu item, plugin, surface, backend.
- Microcopy rules: describe exact endpoint on failures.

## Implementation constraints
- Framework/styling system: React + Vite + Tailwind in `frontend/`.
- Design-token constraints: no new shared design system layer.
- Performance constraints: small static bundle; parallel API fetches.
- Compatibility constraints: `/api/*` dev proxy targets backend `:47778`.
- Test/screenshot expectations: build verification for this slice.

## Open questions
- [ ] Should plugin manifests expose richer non-sensitive surface metadata beyond wasm/menu/server? / lead / improves plugin list completeness.
