# Tests — Lotto Checker

Goodcat Oracle's test pyramid. "แมวที่ดีไม่มีบั๊ก, code ที่ดีไม่มีจุดบอด."

## Layout

```
test/
├── unit/         # pure-Dart logic, models, utils
├── widget/       # flutter_test widget tests under MaterialApp + ProviderScope
├── golden/       # golden_toolkit pixel-snapshot tests (tagged 'golden')
├── integration/  # patrol E2E (Phase 2+)
├── fixtures/     # static JSON / sample payloads
└── helpers/      # pumpApp, golden device presets
```

One behavior per file. Mirror the `lib/` tree under `unit/` and `widget/`.

## Run

```bash
# All non-golden tests (fast, hermetic)
flutter test --exclude-tags golden

# Golden tests only — local, with current host fonts/renderer
flutter test --tags golden

# Update golden baselines after intentional UI change
flutter test --tags golden --update-goldens

# Coverage
flutter test --coverage
genhtml coverage/lcov.info -o coverage/html   # optional HTML report
open coverage/html/index.html                  # macOS
```

## Tags

- `golden` — pixel-snapshot tests. **Excluded from CI's main `test` job** because
  cross-platform font rendering is flaky. A separate `golden` CI job runs them
  on PRs in `continue-on-error` mode.

## Helpers

- `helpers/pump_app.dart` — `tester.pumpApp(widget, overrides: [...])` wraps
  the widget under `ProviderScope` + `MaterialApp`.
- `helpers/golden_config.dart` — `buildStandardDevices(widget)` returns a
  `DeviceBuilder` with iPhone 14 + Pixel 7 presets.

## Skipped tests

Some tests reference codegen output (`*.freezed.dart`, `*.g.dart`) that
`build_runner` produces. Until `dart run build_runner build` runs, those tests
are marked `skip:` with a TODO. Once codegen is in place, remove the skips and
uncomment the bodies.
