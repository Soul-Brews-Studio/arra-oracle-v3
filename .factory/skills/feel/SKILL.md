---
installer: oracle-skills-cli v2.0.0
name: feel
description: v2.0.0 L-SKLL | Log emotions with optional structure. Use when user says "feel", "feeling", "mood", "tired", "sleepy", "frustrated", "happy", "excited".
---

# /feel - Smart Emotion Log

Log emotions + optional structured data for pattern tracking.

## Step 0: Timestamp
```bash
date "+🕐 %H:%M %Z (%A %d %B %Y)"
```

---

## Usage

```
/feel                      # List recent feelings
/feel [mood]               # Quick log: /feel sleepy
/feel [mood] energy:[1-5]  # With energy: /feel tired energy:2
/feel [mood] trigger:[x]   # With trigger: /feel anxious trigger:deadline
```

## Examples

```
/feel sleepy
/feel happy energy:4
/feel frustrated trigger:debugging
/feel panic                 # → suggests /fyi
```

---

## Behavior Matrix

| Input | AI Understands | Action |
|-------|----------------|--------|
| `/feel` (no args) | Review mode | List from feelings log |
| `/feel panic/fear` | Context fear | Suggest `/fyi` or `/rrr` |
| `/feel happy/proud` | Good moment | Suggest `/fyi` to capture |
| `/feel [other]` | Just sharing | Log to diary |

---

## Mode 1: No Arguments → List

Read `ψ/memory/logs/feelings/` and show summary:

```markdown
## /feel - Recent Moods

| Date | Time | Mood | Energy |
|------|------|------|--------|
| Jan 11 | 22:30 | sleepy | 2/5 |
| Jan 11 | 15:00 | focused | 4/5 |

**Pattern**: Energy dips after 22:00
```

---

## Mode 2: With Arguments → Log

### Step 1: Parse input

Extract from ARGUMENTS:
- `mood`: The feeling word(s)
- `energy`: Number 1-5 if provided
- `trigger`: What caused it if provided

### Step 2: Check feeling type

| Contains | Type | Action |
|----------|------|--------|
| panic, fear, กลัว | Context Fear | Suggest /fyi |
| happy, proud, ดีใจ | Happy Moment | Suggest /fyi |
| Other | Diary | Log directly |

### Step 3: Create log entry

Write to `ψ/memory/logs/feels.log` (append):

```
YYYY-MM-DD HH:MM | [mood] | energy:[N] | trigger:[x] | [optional note]
```

Example:
```
2026-01-11 22:33 | sleepy | energy:2 | trigger:late-night | so sleepy today
```

### Step 4: Confirm

```markdown
## /feel logged

**Mood**: 😴 sleepy
**Energy**: ▓▓░░░░░░░░ 2/5
**Trigger**: late-night
**Time**: 22:33

---
Logged to ψ/memory/logs/feels.log
```

---

## Energy Visualization

| Level | Bar | Meaning |
|-------|-----|---------|
| 1 | ▓░░░░░░░░░ | Exhausted |
| 2 | ▓▓░░░░░░░░ | Low |
| 3 | ▓▓▓▓▓░░░░░ | Neutral |
| 4 | ▓▓▓▓▓▓▓░░░ | Good |
| 5 | ▓▓▓▓▓▓▓▓▓▓ | Energized |

---

## Philosophy

> "Rest is also data."

Tracking how you feel reveals patterns:
- When do you feel most focused?
- What triggers energy drops?
- Correlation with work hours?

---

ARGUMENTS: $ARGUMENTS
