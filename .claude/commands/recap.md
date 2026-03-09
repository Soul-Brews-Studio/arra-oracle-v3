---
description: Fresh start context summary
allowed-tools:
  - Bash
  - Task
---

# /recap - Fresh Start Summary

Quick catch-up for new sessions.

## Usage

```
/recap    # Get caught up
```

## Action

Use the Task tool with:
```
subagent_type: context-finder
model: haiku
prompt: |
  Run these commands and summarize:
  1. git log --since="24 hours ago" --format="%h %ar %s" -10
  2. git status --short
  3. gh issue list --limit 5 --json number,title

  Output format:
  ## 🕐 [Current Time]

  ### Recent Changes
  | When | What |
  |------|------|

  ### Working State
  [Clean or list modified files]

  ### Active Issues
  | # | Title |
  |---|-------|

  **Now**: [What to focus on]
```
