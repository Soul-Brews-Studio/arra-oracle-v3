#!/usr/bin/env bash
# Arra Oracle v3 — dev container bootstrap
# Runs once after the container is created in VS Code / GitHub Codespaces
set -euo pipefail

cd "$(dirname "$0")/.."

echo "[post-create] Installing Bun dependencies..."
bun install

echo "[post-create] Ensuring local .env exists..."
if [ ! -f .env ]; then
  cp .env.example .env
  # Safe defaults for the container environment
  sed -i 's|^CHROMA_URL=.*|CHROMA_URL=http://chroma:8000|' .env
fi

echo "[post-create] Arra Oracle v3 ready."
echo "  Start server:  bun run server"
echo "  Health check: curl http://localhost:47778/api/health"
echo "  ChromaDB:     http://localhost:8000"
