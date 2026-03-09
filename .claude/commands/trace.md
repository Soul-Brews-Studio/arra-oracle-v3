---
description: Search git history, retrospectives, issues, codebase
allowed-tools:
  - Bash
  - Grep
  - Glob
  - Task
---

# /trace - Find Anything

Search across git history, issues, files, and retrospectives.

## Usage

```
/trace [query]     # Search for something
/trace incubation  # Show all projects
```

ARGUMENTS: $ARGUMENTS

## Action

Use the Task tool with:
```
subagent_type: context-finder
model: haiku
prompt: |
  Search for "[query]" across:
  1. git log --all --oneline --grep="[query]" | head -15
  2. gh issue list --state all --search "[query]" --json number,title
  3. find . -iname "*[query]*" -type f | head -20
  4. grep -ril "[query]" --include="*.md" | head -20

  Return: Locations found with context
```

## Output Format

```markdown
## 🔍 /trace: [query]

### 📍 Found

| Source | Location | Context |
|--------|----------|---------|
| git | commit abc123 | ... |
| file | path/to/file.md | ... |
| issue | #42 | ... |
```
