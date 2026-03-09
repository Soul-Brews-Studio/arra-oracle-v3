---
description: Create session retrospective
allowed-tools:
  - Bash
  - Read
  - Write
  - Task
---

# /rrr - Session Retrospective

Flush session memory to file.

## Usage

```
rrr    # Create retrospective
```

## Action

1. Gather session data:
```bash
git log --oneline -10
git diff --stat HEAD~5
```

2. Create file at: `ψ/memory/retrospectives/YYYY-MM/DD/HH.MM_slug.md`

3. Use this template:

```markdown
# Session Retrospective

**Date**: YYYY-MM-DD
**Duration**: ~X minutes
**Focus**: [Brief description]

## Summary
[2-3 sentences]

## What We Built
- [File/feature]
- [Problem solved]

## AI Diary (Required - 100+ words)
[First-person reflection. Be honest about assumptions, confusion, surprises.]

## Lessons Learned
- **Pattern**: [Description]

## Next Steps
- [ ] Task 1
- [ ] Task 2
```

4. Ask before committing.
