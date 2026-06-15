---
name: munin
argument-hint: "<query> [--deep] [--git] [--vaults] [--all-roots] [--all-slugs] [--print]"
description: Munin — thin WHERE-finder for Arra. Use when the user asks "where is X?", "find X across the repo/fleet", "where did X move?", or "what paths mention X?" Sweeps local code roots, session slugs, vault/backups, and optional git pickaxe; leans on existing oracle_search/oracle_trace instead of reimplementing search. Completes Arra's Three Ravens with /huginn and /sleipnir.
type: local
origin: arra-oracle-v3
---

# /munin — Arra's Memory Raven

Munin answers one question: **where should I look?**

Adapted from Odin Oracle's `/munin` five-axis WHERE-finder (`ψ/learn/Soul-Brews-Studio/odin-oracle/2026-05-30/2252_HUGINN-MUNINN.md`), narrowed for Arra paths and existing `oracle_*` recall tools.

Keep it thin. It is a finder UX over existing recall surfaces (`oracle_search`, `oracle_trace`, repo grep, session slugs, vault paths, optional git pickaxe). It is **not** a new transport, federation layer, indexer, or server feature.

## Usage

```text
/munin <query>              # local WHERE sweep
/munin <query> --deep       # include every local axis below
/munin <query> --git        # add git pickaxe / commit grep
/munin <query> --vaults     # expand ψ-backup / .bak / old vault paths
/munin <query> --all-roots  # include old /Users and /home Code roots when present
/munin <query> --all-slugs  # include old Claude session slug prefixes
/munin <query> --print      # print only; do not write ψ/memory/munin
```

## Flight rules

1. **Start with recall** when available:
   - Use `oracle_search` for semantic / FTS memory hits.
   - Use `oracle_trace` or trace-list/read tools for prior investigation breadcrumbs.
   - If MCP is unavailable, continue with filesystem/session/git axes and mark MCP as unavailable.
2. **Search-only.** Do not restore files, rewrite paths, copy vaults, start daemons, or mutate server code.
3. **Rank by authority:** source-alpha file > git commit/PR > trace record > session quote > vault note > filename-only hit.
4. **Report locations, not theories.** Every headline should include a path, PR/commit, trace id, or command evidence.
5. **Stay local by default.** Cross-host/federation lookups are out of scope unless the user explicitly asks; use current federation tools separately.

## Local axes

Run the smallest useful sweep first; add flags only when needed.

### Axis 0 — topology probe

```bash
pwd
printf 'roots:\n'
for r in /opt/Code "$HOME/Code" /Users/nat/Code /home/nat/Code; do
  [ -d "$r" ] && echo "  present $r" || true
done
printf 'session slugs:\n'
for p in -opt-Code- -Users-nat-Code- -home-nat-Code-; do
  find "$HOME/.claude/projects" -maxdepth 1 -type d -name "${p}*" 2>/dev/null | wc -l | xargs echo "  $p"
done
```

### Axis 1 — Arra recall

Prefer the MCP tools when available:

```text
oracle_search(query=<query>, limit=10)
oracle_trace(query=<query>) or oracle_trace_list(query=<query>, limit=10)
```

If only the HTTP CLI is available, use thin wrappers:

```bash
arra search "$QUERY" --limit 10
arra trace "$QUERY" 2>/dev/null || true
```

### Axis 2 — source tree and docs

```bash
rg -n --hidden --glob '!node_modules' --glob '!.git' "$QUERY" . /opt/Code/github.com/Soul-Brews-Studio/arra-oracle-v3-oracle 2>/dev/null | head -80
find . /opt/Code/github.com/Soul-Brews-Studio/arra-oracle-v3-oracle -iname "*$QUERY*" 2>/dev/null | head -40
```

### Axis 3 — session slugs

Default to current `/opt/Code` slugs. Add old prefixes with `--all-slugs`.

```bash
for prefix in -opt-Code- ${ALL_SLUGS:+-Users-nat-Code- -home-nat-Code-}; do
  find "$HOME/.claude/projects" -maxdepth 1 -type d -name "${prefix}*" 2>/dev/null \
    -exec rg -n --max-count 5 "$QUERY" {} \; 2>/dev/null | head -80
done
```

### Axis 4 — vaults and backups

```bash
find . /opt/Code/github.com/Soul-Brews-Studio/arra-oracle-v3-oracle \
  \( -path '*/ψ/*' -o -path '*/ψ-backup-*/*' -o -path '*/ψ-local-backup/*' \) \
  -type f -name '*.md' -print0 2>/dev/null | xargs -0 rg -n "$QUERY" 2>/dev/null | head -80

# With --vaults, also check old snapshots.
find /opt/Code -maxdepth 4 \( -name 'ψ-backup-*' -o -name '.bak-*' -o -name 'oracle-vault' \) 2>/dev/null | head -80
```

### Axis 5 — git pickaxe (`--git` or `--deep`)

```bash
for repo in . /opt/Code/github.com/Soul-Brews-Studio/arra-oracle-v3-oracle; do
  [ -d "$repo/.git" ] || continue
  (cd "$repo" && {
    git log --all --date=short --pretty='%h %ad %s' --grep="$QUERY" 2>/dev/null | head -20
    git log --all --date=short --pretty='%h %ad %s' -S"$QUERY" 2>/dev/null | head -20
  })
done
```

## Output shape

Return concise markdown:

```markdown
## 🪶 Munin: <query>

### Top locations
- `<path>` — why it matters; evidence source; confidence
- `<PR/commit/trace>` — why it matters; evidence source; confidence

### By axis
- Arra recall: N hits / unavailable
- Source tree: N hits
- Sessions: N hits across N slugs
- Vaults/backups: N hits
- Git pickaxe: N hits / skipped

### Suggested next look
1. Open `<best path>` because ...
2. Check `<trace/PR>` because ...
3. If still missing, rerun `/munin <query> --deep --git --vaults`.

### Friction
- score: 0.0–1.0
- blockers: unavailable axes only
```

If writing a record, use:

```text
ψ/memory/munin/YYYY-MM-DD/HHMM_munin_<query-slug>.md
```

Then add one line to `ψ/memory/munin/YYYY-MM-DD/INDEX.md`:

```text
- HH:MM — "<query>" — <N> locations across <N> axes — <file>
```

## Three Ravens context

- `/huginn` — present / what changed now.
- `/munin` — memory / where the thing lives.
- `/sleipnir` — cross-pane / many-legged synthesis.

Arra already owns the memory substrate (`oracle_search`, `oracle_trace`, and `muninn_*` backward-compatible aliases). This skill is the human-facing WHERE-finder over that substrate.
