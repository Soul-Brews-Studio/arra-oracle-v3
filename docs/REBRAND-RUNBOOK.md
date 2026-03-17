# Rebrand Runbook: oracle-v2 → arra-oracle

> วันที่สร้าง: 2026-03-16
> สถานะ: พร้อม execute

## Pre-flight Checklist

- [x] PR #423 (oracle-v2 source) — tests pass, code review done
- [x] PR #71 (oracle-skills-cli) — 110 tests pass
- [x] PR #1 (oracle-cli), #2 (oracle-studio) — ready
- [x] PR #4 (mother-oracle registry) — ready
- [x] Fleet CLAUDE.md PRs (8 repos) — ready
- [x] `~/.claude.json` MCP key already renamed to `arra-oracle`
- [x] `~/.claude.json` backup at `~/.claude.json.bak-before-rebrand`

---

## Execute (ทำตามลำดับ)

### Phase 1: Merge + Rename (5 นาที)

```bash
# 1. Merge PR หลัก
gh pr merge 423 --repo Soul-Brews-Studio/oracle-v2 --merge

# 2. Rename repo (ATOMIC — GitHub auto-redirect ทันที)
gh repo rename arra-oracle --repo Soul-Brews-Studio/oracle-v2

# 3. Verify redirect works
gh repo view Soul-Brews-Studio/arra-oracle --json name
# Expected: { "name": "arra-oracle" }
```

### Phase 2: Update Local (5 นาที)

```bash
# 4. Re-clone to new ghq path
ghq get -u -p Soul-Brews-Studio/arra-oracle

# 5. Update ~/.claude.json paths (ใช้ jq)
jq '
  .mcpServers["arra-oracle"].args = [
    "/home/nat/Code/github.com/Soul-Brews-Studio/arra-oracle/src/index.ts"
  ] |
  .mcpServers["arra-oracle"].env.ORACLE_REPO_ROOT =
    "/home/nat/Code/github.com/Soul-Brews-Studio/arra-oracle"
' ~/.claude.json > /tmp/claude-json-tmp && mv /tmp/claude-json-tmp ~/.claude.json

# 6. Verify MCP config
jq '.mcpServers["arra-oracle"]' ~/.claude.json
```

### Phase 3: Merge Fleet (10 นาที)

```bash
# 7. Skills CLI (สำคัญ — gh commands ต้องชี้ repo ใหม่)
gh pr merge 71 --repo Soul-Brews-Studio/oracle-skills-cli --merge

# 8. Oracle CLI + Studio
gh pr merge 1 --repo Soul-Brews-Studio/oracle-cli --merge
gh pr merge 2 --repo Soul-Brews-Studio/oracle-studio --merge

# 9. Mother Oracle (registry sync)
gh pr merge 4 --repo laris-co/mother-oracle --merge

# 10. Neo Oracle
gh pr merge 13 --repo laris-co/neo-oracle --merge

# 11. Fleet CLAUDE.md (batch)
gh pr merge 5 --repo laris-co/floodboy-oracle --merge
gh pr merge 2 --repo laris-co/thong-pradit-brewing-oracle --merge
gh pr merge 3 --repo laris-co/dustboy-chain-oracle --merge
gh pr merge 3 --repo laris-co/brews-boy-oracle --merge
gh pr merge 19 --repo Soul-Brews-Studio/shrimp-oracle --merge
gh pr merge 8 --repo Soul-Brews-Studio/openclaw-oracle-guide --merge
gh pr merge 2 --repo Soul-Brews-Studio/clawdacle --merge
```

### Phase 4: Verify (5 นาที)

```bash
# 12. Old URL redirects?
curl -sI https://github.com/Soul-Brews-Studio/oracle-v2 | head -3
# Expected: 301 → arra-oracle

# 13. Registry sync works?
cd ~/Code/github.com/laris-co/mother-oracle && bun registry/sync.ts

# 14. MCP server starts?
# (restart Claude Code session — new MCP prefix mcp__arra-oracle__*)

# 15. Skills work?
# /oracle-family-scan --stats
```

---

## Rollback (ถ้ามีปัญหา)

```bash
# Rename back
gh repo rename oracle-v2 --repo Soul-Brews-Studio/arra-oracle

# Revert ~/.claude.json
cp ~/.claude.json.bak-before-rebrand ~/.claude.json

# Revert registry
cd ~/Code/github.com/laris-co/mother-oracle
git checkout main -- registry/config.json registry/sync.ts
```

---

## Post-Rebrand (ทำทีหลังได้)

- [ ] Regenerate `skills-vfs.ts` in oracle-skills-cli
- [ ] `maw hey` fleet notification — "oracle-v2 is now arra-oracle"
- [ ] Update buildwithoracle.com blog posts (Calliope)
- [ ] npm publish under new name `arra-oracle`
- [ ] Clean up old ghq path: `rm -rf ~/Code/github.com/Soul-Brews-Studio/oracle-v2`

---

## Impact Summary

| What | Before | After |
|------|--------|-------|
| Repo | Soul-Brews-Studio/oracle-v2 | Soul-Brews-Studio/arra-oracle |
| npm | oracle-v2 | arra-oracle |
| MCP prefix | mcp__oracle-v2__* | mcp__arra-oracle__* |
| bin | `bunx oracle-v2` | `bunx arra-oracle` |
| Data dir | `~/.oracle/` | `~/.oracle/` (unchanged) |
| DB path | `~/.oracle/oracle.db` | `~/.oracle/oracle.db` (unchanged) |
