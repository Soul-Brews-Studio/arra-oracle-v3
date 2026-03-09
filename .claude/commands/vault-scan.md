---
description: Scan vault-rsync eligible repos and summarize
allowed-tools:
  - Bash
  - Read
---

# /vault-scan - Vault Rsync Scanner

Scan all ghq repos, show which have real (non-symlinked) `ψ/` dirs eligible for rsync to the central vault, and summarize the state.

## Usage

```
/vault-scan              # CLI summary
/vault-scan --report     # Generate HTML dashboard (via oracle-vault-report repo)
```

## Action

### CLI Summary (default)

Run the vault-rsync script in list mode and gather vault status:

```bash
# 1. List eligible repos
./scripts/vault-rsync.sh --list

# 2. Count total repos with ψ (symlinked vs real)
echo "=== Vault Overview ==="
GHQ_ROOT="$(ghq root)"
VAULT="$(ghq list -p | grep '/oracle-vault$' | head -1)"
sym=0; real=0; total=0
for repo in $(ghq list -p); do
  if [ -L "$repo/ψ" ]; then sym=$((sym+1)); total=$((total+1))
  elif [ -d "$repo/ψ" ]; then real=$((real+1)); total=$((total+1)); fi
done
echo "Total repos with ψ/: $total"
echo "  Symlinked (vault): $sym"
echo "  Real (needs sync): $real"

# 3. Vault repo stats
echo ""
echo "=== Vault Stats ==="
echo "Vault path: $VAULT"
find "$VAULT/github.com" -name '*.md' | wc -l | xargs -I{} echo "Total .md files in vault: {}"
ls "$VAULT/github.com" | wc -l | xargs -I{} echo "Orgs indexed: {}"
du -sh "$VAULT/github.com" | cut -f1 | xargs -I{} echo "Vault size: {}"
```

Then present a markdown summary table.

### HTML Report (--report)

The report generator lives in a separate repo: `oracle-vault-report`

```bash
REPORT_REPO="$(ghq list -p | grep oracle-vault-report | head -1)"
cd "$REPORT_REPO" && node generate.mjs && open index.html
```

Generates:
- `index.html` — OLED dark-mode dashboard (hero stats, charts, tables)
- `data.json` — raw metrics for programmatic access

To deploy to GitHub Pages:
```bash
cd "$REPORT_REPO" && node generate.mjs --push
```

### Quick Actions
- `./scripts/vault-rsync.sh --dry-run` — preview rsync changes
- `./scripts/vault-rsync.sh` — sync now
- `./scripts/vault-rsync.sh --commit` — sync + commit + push
