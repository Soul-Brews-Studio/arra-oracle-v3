#!/bin/bash
# Arra Oracle Installer
# Inspired by claude-mem's installation pattern
#
# Usage:
#   curl -fsSL .../install.sh | bash                    # Install latest stable tag
#   ORACLE_NIGHTLY=1 curl -fsSL .../install.sh | bash   # Install from main (developers)
#   ORACLE_VERSION=v1.0.0 curl -fsSL .../install.sh | bash  # Install specific version

set -e

INSTALL_DIR="${ORACLE_INSTALL_DIR:-$HOME/.local/share/arra-oracle-v2}"
REPO_URL="https://github.com/Soul-Brews-Studio/arra-oracle-v2.git"
REPO_API="https://api.github.com/repos/Soul-Brews-Studio/arra-oracle-v2"

echo "🔮 Arra Oracle Installer"
echo "======================"
echo ""

# Check for bun
if ! command -v bun &> /dev/null; then
    echo "❌ Bun not found. Install it first:"
    echo "   curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

# Determine version to install
if [ -n "$ORACLE_NIGHTLY" ]; then
    VERSION="main"
    echo "🌙 Installing nightly (main branch)..."
elif [ -n "$ORACLE_VERSION" ]; then
    VERSION="$ORACLE_VERSION"
    echo "📌 Installing version: $VERSION"
else
    # Fetch latest tag from GitHub API
    echo "🔍 Finding latest stable version..."
    VERSION=$(curl -sL "$REPO_API/tags" | grep -o '"name": "[^"]*"' | head -1 | cut -d'"' -f4)
    if [ -z "$VERSION" ]; then
        echo "⚠️  No tags found, falling back to main"
        VERSION="main"
    else
        echo "📦 Latest stable: $VERSION"
    fi
fi

# Check if already installed
if [ -d "$INSTALL_DIR" ]; then
    echo "📁 Found existing installation at $INSTALL_DIR"
    echo "   Updating to $VERSION..."
    cd "$INSTALL_DIR"
    git fetch --all --tags
    if [ "$VERSION" = "main" ]; then
        git checkout main
        git pull origin main
    else
        git checkout "$VERSION"
    fi
    bun install
else
    echo "📥 Cloning to $INSTALL_DIR..."
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
    if [ "$VERSION" != "main" ]; then
        git checkout "$VERSION"
    fi
    bun install
fi

# Create data directory
mkdir -p ~/.oracle

# Add to Claude Code MCP
echo ""
echo "📝 Adding to Claude Code..."
claude mcp add arra-oracle-v2 -- bun run "$INSTALL_DIR/src/index.ts" 2>/dev/null || {
    echo "⚠️  claude mcp add failed - you may need to add manually"
}

echo ""
echo "✅ Installation complete!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 Copy this to your AI (problems @tacha-hash faced):"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cat << 'EOF'

arra-oracle-v2 installed! Please restart Claude Code.

If you see errors, here are fixes from @tacha-hash's 20-min debug session:

| Problem | Fix |
|---------|-----|
| "bun not found" | export PATH="$HOME/.bun/bin:$PATH" |
| "bunx not found" | Use ~/.bun/bin/bunx |
| "directory does not exist" | mkdir -p ~/.oracle |
| ChromaDB hangs | Ignore - SQLite works without vectors |
| MCP not loading | Check .mcp.json or ~/.claude.json |

EOF
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🎉 Restart Claude Code to activate Arra Oracle"
