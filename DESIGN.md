# Design

## Source of truth
- Status: Draft
- Last refreshed: 2026-06-15
- Primary product surfaces: Routed frontend dashboard for menu, plugin, vector, MCP, and settings discovery.
- Evidence reviewed: `src/routes/menu/menu.ts`, `src/routes/plugins/model.ts`, `src/routes/plugins/list.ts`, `frontend/src/components/VectorSearchWidget.tsx`, `frontend/src/components/McpToolBrowser.tsx`, `frontend/index.html`.

## Brand
- Personality: technical, calm, observability-first Oracle tooling.
- Trust signals: live API status, explicit loading/error/empty states, visible metadata.
- Avoid: decorative UI that hides operational state.

## Product goals
- Goals: expose routed pages for `/api/menu`, `/api/plugins`, vector search, MCP tools, and frontend runtime settings.
- Non-goals: editing menus/plugins/settings, auth flows, or embedding the legacy web marketing site.
- Success signals: frontend build passes; users can navigate routes and scan menu, plugin, vector, MCP, and settings surfaces on desktop/mobile; static frontend shell assets are installable/cacheable for offline revisit.

## Personas and jobs
- Primary personas: Oracle operators, plugin authors, maintainers.
- User jobs: confirm backend connectivity, inspect available navigation, inspect registered plugins/surfaces, run vector searches, and browse MCP tools.
- Key contexts of use: local Vite dev proxy to `:47778`, same-origin deployed UI.

## Information architecture
- Primary navigation: responsive React Router sidebar for Menu, Plugins, Vector, MCP, and Settings.
- Core routes/screens: `/menu`, `/plugins`, `/vector`, `/mcp`, `/settings`; `/` redirects to `/menu`.
- Content hierarchy: sidebar navigation, breadcrumb trail, route-specific title, connection/status summary, then one focused routed page at a time.

## Design principles
- Principle 1: make live system state visible before details.
- Principle 2: prefer dense but readable operational cards.
- Tradeoffs: lightweight route components over a larger design-system layer.

## Visual language
- Color: dark neutral base with teal/cyan Oracle accent and purple secondary accent.
- Typography: system sans for UI, mono for paths/commands.
- Spacing/layout rhythm: roomy mobile-first cards, two-column desktop panels.
- Shape/radius/elevation: rounded cards, subtle borders, low shadow.
- Motion: minimal hover/focus transitions only.
- Imagery/iconography: text badges over icon dependencies.

## Components
- Existing components to reuse: `VectorSearchWidget`, `McpToolBrowser`, menu/plugin cards, and existing frontend visual patterns in `frontend/src/styles.css`.
- New/changed components: nav sidebar, breadcrumb/title chrome, routed pages, status banner, stat cards, menu cards, plugin cards, badges.
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
- Layout adaptations: sidebar stacks above content on small screens and becomes sticky at desktop widths; summary cards wrap.
- Touch/hover differences: cards do not require hover-only controls.

## Interaction states
- Loading: pulse-style text placeholders.
- Empty: explicit empty cards for no menu/plugins.
- Error: retry button with error message.
- Success: updated timestamp and populated cards.
- Disabled: no disabled controls in this slice.
- Offline/slow network: fetch timeout is browser-managed; retry is available; service worker caches static shell assets while API data remains live-only.

## Content voice
- Tone: concise, operational, transparent.
- Terminology: menu item, plugin, surface, backend.
- Microcopy rules: describe exact endpoint on failures.

## Implementation constraints
- Framework/styling system: React + React Router + Vite + Tailwind in `frontend/`.
- Design-token constraints: no new shared design system layer.
- Performance constraints: small static bundle; parallel API fetches.
- Compatibility constraints: `/api/*` dev proxy targets backend `:47778`; service worker is production-only and skips `/api/*` caching.
- Test/screenshot expectations: build verification for this slice.

## Open questions
- [ ] Should plugin manifests expose richer non-sensitive surface metadata beyond wasm/menu/server? / lead / improves plugin list completeness.
