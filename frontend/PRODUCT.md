# Product

## Product surface
Arra Oracle Studio is the React/Tauri operator UI for the Arra Oracle V3 memory,
search, plugin, vector, forum, and backend status surfaces.

## Users and jobs
- Oracle operators verify backend connectivity, health, routes, and runtime settings.
- Maintainers inspect plugin inventory, exposed surfaces, and diagnostics before shipping.
- Agent/team leads use Forum and Status pages to scan operational conversations and state.

## Product promise
Make live Oracle backend state visible, readable, and actionable without hiding
failures behind decorative UI. Every page should answer: what is connected,
what changed, and where can the operator act next?

## Tone
Calm, technical, observability-first. Prefer concise labels, explicit endpoint
names, timestamps, and plain operational language.

## Design boundaries
- Use existing Tailwind tokens and Studio shell patterns; do not introduce a new
  design system layer.
- Keep mobile layouts single-column and desktop layouts dense but scannable.
- Prioritize accessible focus states, readable contrast, wrapping long paths, and
  clear loading/error/empty states.
- Avoid decorative gradients, glass effects, motion, or card nesting that makes
  diagnostics harder to scan.

## Success criteria
The Studio pages for Forum, Plugins, Settings, and Status remain responsive,
keyboard-accessible, theme-aware, and buildable with the repository frontend
build gate.
