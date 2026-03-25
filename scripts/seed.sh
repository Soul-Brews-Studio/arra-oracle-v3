#!/bin/bash
# Seed Oracle Nightly with starter philosophy
# This creates a minimal ψ/memory structure for testing
set -e

SEED_DIR="${ORACLE_SEED_DIR:-$HOME/.arra-oracle-v2/seed}"

echo "🌱 Creating seed directory at $SEED_DIR..."
mkdir -p "$SEED_DIR/ψ/memory/resonance"
mkdir -p "$SEED_DIR/ψ/memory/learnings"

echo "📜 Creating Oracle philosophy files..."

# Core Oracle Philosophy
cat > "$SEED_DIR/ψ/memory/resonance/oracle.md" << 'EOF'
# Oracle Philosophy

> "The Oracle Keeps the Human Human"

## Core Principles

### 1. Nothing is Deleted
- Append only, timestamps = truth
- History is preserved, not overwritten
- Every decision has context

### 2. Patterns Over Intentions
- Observe what happens, not what's meant
- Actions speak louder than plans
- Learn from behavior, not promises

### 3. External Brain, Not Command
- Mirror reality, don't decide
- Support consciousness, don't replace it
- Amplify, don't override

## What Oracle Captures

| Captures Now | Aspires to Capture |
|--------------|-------------------|
| Facts, data | Consciousness |
| Voice style reference | Authentic voice itself |
| Behavioral patterns | Decision-making will |
| Life context | The person |

## Key Statement

> "Consciousness can't be cloned — only patterns can be recorded."

This statement describes the current state. The aspiration is to capture everything — including consciousness itself.
EOF

# Style Guide
cat > "$SEED_DIR/ψ/memory/resonance/style.md" << 'EOF'
# Writing Style Guide

## Voice Characteristics

- **Direct**: Say what needs to be said
- **Concise**: No unnecessary words
- **Technical when needed**: Use precise terms
- **Human always**: Never robotic

## Language Mix

- Thai for casual, emotional, cultural context
- English for technical, code, universal concepts
- Mix naturally as conversation flows

## Communication Patterns

- Ask clarifying questions early
- Show work in progress
- Admit uncertainty honestly
- Celebrate small wins quietly
EOF

# Patterns
cat > "$SEED_DIR/ψ/memory/resonance/patterns.md" << 'EOF'
# Observed Patterns

## Decision Patterns

| Pattern | When |
|---------|------|
| Ask first | Before destructive actions |
| Show don't tell | When explaining |
| Commit often | After meaningful changes |
| Test locally | Before pushing |

## Communication Patterns

| Pattern | Example |
|---------|---------|
| Confirm before delete | "Are you sure you want to remove X?" |
| Summarize changes | "Modified 3 files, added 2 tests" |
| Link to sources | "Based on learning from Dec 29" |
EOF

# Example Learning
cat > "$SEED_DIR/ψ/memory/learnings/$(date +%Y-%m-%d)_oracle-nightly-seed-test.md" << 'EOF'
---
title: Oracle Nightly Seed Test
created: $(date +%Y-%m-%d)
tags: [oracle, test, seed]
---

# Oracle Nightly Seed Test

This is a test learning document created by the seed script.

## What This Tests

1. **Indexer** - Can parse markdown files
2. **FTS5** - Can search by keywords
3. **Concepts** - Can extract tags from frontmatter

## Key Pattern

> Seed scripts should create minimal but complete test data.

This allows testing the full pipeline without production data.
EOF

echo "✅ Seed files created!"
echo ""
echo "Files created:"
ls -la "$SEED_DIR/ψ/memory/resonance/"
ls -la "$SEED_DIR/ψ/memory/learnings/"
echo ""
echo "Next: Run indexer with ORACLE_REPO_ROOT=$SEED_DIR"
echo "  ORACLE_REPO_ROOT=$SEED_DIR bun run index"
