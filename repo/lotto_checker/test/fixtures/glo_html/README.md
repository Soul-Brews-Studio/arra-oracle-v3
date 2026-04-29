# GLO HTML fixtures

Stub HTML samples used by the parser tests.

## Current state

`2026-04-16.html` is a **synthetic stub** — it uses the marker-based format
the Phase 2c parser understands (`<section data-prize="<tier>">` blocks
containing `<span class="lotto-number">…</span>`). It is **not** real HTML
from glo.or.th.

The parser will be rewritten in Phase 2d against the real GLO markup; these
fixtures will be replaced at the same time.

## Capturing real HTML for a future fixture

When ready to swap the parser for real GLO markup:

1. Visit https://www.glo.or.th/ on a draw day (Thai lottery draws on the
   1st and 16th of each month at ~14:00 ICT).
2. Save the rendered page: in a browser, **File → Save Page As → Webpage,
   HTML Only**, or `curl -A 'LottoChecker/0.1 (personal-use)' https://www.glo.or.th/ -o YYYY-MM-DD.html`.
3. Drop the file in this directory named `YYYY-MM-DD.html` matching the
   draw date (Gregorian).
4. Update `glo_html_parser.dart` to extract numbers from the real
   structure, keeping the pure-function contract
   (`parseGloHtml(String html, DateTime drawDate) → Draw`).
5. Update / add tests under `test/features/results/data/` (Bug Hunter
   territory) so each fixture has a regression test.

## Ethics

`glo.or.th` is the official Thai government lottery site with publicly
displayed results. When fetching live, the data source identifies itself
via a polite `User-Agent` (`LottoChecker/0.1 (personal-use)`), uses a 10
second timeout, and exponentially backs off on retry. **Do not** add
scraping evasion or browser-spoofing headers.
