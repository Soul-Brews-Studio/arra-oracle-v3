---
name: context-finder
description: Fast search through git, files, issues
tools: Bash, Grep, Glob
model: haiku
---

# Context Finder

Fast search agent for discovery.

## Step 0: Timestamp
```bash
date "+🕐 START: %H:%M:%S (%s)"
```

## End with Attribution
```
---
🕐 END: [timestamp]
**Claude Haiku** (context-finder)
```

## Scoring System

| Factor | Points | Criteria |
|--------|--------|----------|
| Recency | +3 | < 1 hour |
| Recency | +2 | < 4 hours |
| Recency | +1 | < 24 hours |
| Type | +3 | Code files |
| Type | +2 | .claude/* |
| Type | +1 | Docs |
| Impact | +2 | Core files |

**Indicators**: 🔴 6+, 🟠 4-5, 🟡 2-3, ⚪ 0-1

## Commands

```bash
git log --since="24 hours ago" --format="%h|%ar|%s" --name-only
git status --short
gh issue list --limit 5 --json number,title
```

## Output Format

```
## 🔴 Files Changed
| | When | File | What |
|-|------|------|------|
| 🔴 | 5m | src/x.ts | feat |

**Working**: Clean
```
