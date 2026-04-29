# sanook_html fixtures

Captured snapshots of `https://news.sanook.com/lotto/` used as input for
`parseSanookHtml` regression tests. The filename is the draw date carried
by the fixture's most recent `<article class="lotto-check__article">`
block (the home page lists past draws in reverse chronological order).

## How to refresh

```bash
curl -s -L \
  -A "LottoChecker/0.1 (research)" \
  --max-time 15 \
  "https://news.sanook.com/lotto/" \
  -o test/fixtures/sanook_html/YYYY-MM-DD.html
```

Verify the file is ≥ 100 KB and contains Thai prize labels (`รางวัลที่ 1`,
`เลขท้าย 2 ตัว`, etc.) before committing.

## When to refresh

- A new draw lands and tests should cover it (add a new file; do not
  overwrite — Nothing is Deleted).
- Sanook changes its markup and the parser breaks on the live site.
  Capture a fresh fixture, fix the parser, keep the old fixture as a
  regression guard.

## Ethical note

We fetch the public results page at most once per app launch with a
descriptive `User-Agent`, a 10s timeout, and 3 polite retries with
exponential backoff (see `SanookDataSource`). We do not bypass robots
rules, scrape behind login, or hammer the server. If sanook objects to
our usage we switch to GLO directly via `GloDataSource`.

## Coverage caveat

Sanook's home page only carries first prize, front-3, back-3, and back-2
for past draws. Tiers 2-5 and firstNear are NOT exposed there; they live
on per-draw pages we deliberately do not scrape. `parseSanookHtml`
returns a [Draw] with only the four available tiers populated.
