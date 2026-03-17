# Arra Oracle Installation Guide

Complete guide for fresh installation with seed data.

## Quick Install (Recommended)

```bash
curl -sSL https://raw.githubusercontent.com/Soul-Brews-Studio/arra-oracle/main/scripts/fresh-install.sh | bash
```

This one-liner will:
1. Clone to `~/.local/share/arra-oracle`
2. Install dependencies
3. Create seed philosophy files
4. Index seed data (29 documents)
5. Run tests

## What Gets Created

### Installation Directory
```
~/.local/share/arra-oracle/    # Code
~/.oracle/                 # Data
├── oracle.db                 # SQLite database
└── seed/                     # Seed philosophy files
    └── ψ/memory/
        ├── resonance/        # Core principles
        │   ├── oracle.md
        │   ├── patterns.md
        │   └── style.md
        └── learnings/        # Example learning
```

### Seed Philosophy Content

**oracle.md** - Core Oracle Philosophy:
- Nothing is Deleted (append only)
- Patterns Over Intentions (observe behavior)
- External Brain, Not Command (mirror, don't decide)

**patterns.md** - Decision Patterns:
- Ask first before destructive actions
- Show don't tell
- Commit often

**style.md** - Communication Style:
- Direct, Concise, Technical when needed, Human always

## Post-Install Verification

### 1. Start Server
```bash
cd ~/.local/share/arra-oracle
bun run server
```

### 2. Check Stats
```bash
curl http://localhost:47778/api/stats
```

Expected: `{"total": 29, "by_type": {"learning": 3, "principle": 26}}`

### 3. Test Search
```bash
curl "http://localhost:47778/api/search?q=nothing+deleted"
```

Expected: Top result is "Nothing is Deleted" principle

## Claude Code Configuration

Add to `~/.claude.json`:
```json
{
  "mcpServers": {
    "arra-oracle": {
      "command": "bun",
      "args": ["run", "~/.local/share/arra-oracle/src/index.ts"]
    }
  }
}
```

## Manual Installation

If you prefer step-by-step:

```bash
# 1. Clone
git clone https://github.com/Soul-Brews-Studio/arra-oracle.git ~/.local/share/arra-oracle
cd ~/.local/share/arra-oracle

# 2. Install dependencies
bun install

# 3. Setup database
bun run db:push

# 4. Create seed data
./scripts/seed.sh

# 5. Index seed data
ORACLE_REPO_ROOT=~/.oracle/seed bun run index

# 6. Start server
bun run server
```

## Index Your Own Knowledge

To index your own ψ/memory files:

```bash
ORACLE_REPO_ROOT=/path/to/your/repo bun run index
```

The indexer scans:
- `ψ/memory/resonance/*.md` → principles
- `ψ/memory/learnings/*.md` → learnings
- `ψ/memory/retrospectives/**/*.md` → retrospectives

## Optional: Vector Search

For semantic/vector search (in addition to keyword FTS5):

```bash
# Install uv (provides uvx)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Restart server - will auto-connect to ChromaDB
bun run server
```

Without uvx, Oracle falls back to FTS5-only search (still works).

## Troubleshooting

### Search returns 0 results after indexing

Server caches database state. Restart after indexing:
```bash
pkill -f 'bun.*server'
bun run server
```

### Indexer fails with ENOENT

Directory structure must be `ψ/memory/` not just `memory/`:
```bash
# Wrong
~/.oracle/seed/memory/resonance/

# Correct
~/.oracle/seed/ψ/memory/resonance/
```

### Vector search unavailable warning

uvx not installed. FTS5 keyword search still works. Install uv for vectors:
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

## Uninstall

```bash
rm -rf ~/.local/share/arra-oracle
rm -rf ~/.oracle
```

---

See also:
- [README.md](../README.md) - Overview
- [API.md](./API.md) - API documentation
- [architecture.md](./architecture.md) - System architecture
