# Test fixtures

Static JSON / data fixtures used by tests live here.

## Conventions

- One file per fixture, named after what it represents (e.g. `draw_2026_01_16.json`).
- Keep fixtures small — only the fields tests actually read.
- Load via `File('test/fixtures/<name>.json').readAsStringSync()` from a test
  (Flutter's test runner uses repo root as CWD).
- Treat fixtures as append-only snapshots; if real data changes, add a new
  dated file rather than mutating an old one (Oracle principle: nothing is
  deleted).

## Planned fixtures (Phase 2+)

- `draw_2026_01_16.json` — sample GLO draw payload for Draw model tests.
- `tickets_seed.json` — seed tickets for repository tests.
