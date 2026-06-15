# Local Claude skills

## Three Ravens

Arra's local raven skills are thin UX layers over existing memory/search surfaces:

- `/huginn` — present-tense work tracking: what changed now.
- `/munin` — memory WHERE-finder: where does a query live across code roots, sessions, vaults/backups, and git history.
- `/sleipnir` — cross-pane synthesis: many-legged pattern extraction.

`/munin` intentionally does not add server code or a new transport. It leans on existing Arra recall (`oracle_search`, `oracle_trace`) plus local filesystem/session/git evidence.
