#!/usr/bin/env bash
# Parse only embedding settings; never source a credential file as shell code.
load_restore_embedding_env() {
  local file="$1" mode provider model endpoint key
  [[ -f "$file" && ! -L "$file" && -r "$file" ]] || { echo "embedding env must be a readable regular file" >&2; return 2; }
  mode="$(stat -c '%a' "$file" 2>/dev/null || stat -f '%Lp' "$file")"
  [[ "$mode" == "600" ]] || { echo "embedding env must be mode 600" >&2; return 2; }
  provider="$(sed -n 's/^ORACLE_EMBEDDER=//p' "$file" | head -n 1)"
  model="$(sed -n 's/^ORACLE_EMBEDDING_MODEL=//p' "$file" | head -n 1)"
  restore_embedding_env=("VECTOR_FALLBACK=fail" "ORACLE_EMBED_TIMEOUT_MS=120000" "ORACLE_EMBED_BATCH_SIZE=4")
  case "${provider:-openai}" in
    ollama)
      endpoint="$(sed -n 's/^OLLAMA_BASE_URL=//p' "$file" | head -n 1)"
      endpoint="${endpoint:-http://127.0.0.1:11434}"
      [[ "$endpoint" =~ ^http://127\.0\.0\.1:[0-9]+$ ]] || { echo "Ollama restore endpoint must be loopback HTTP" >&2; return 2; }
      restore_embedding_env+=("ORACLE_EMBEDDER=ollama" "ORACLE_EMBEDDING_MODEL=${model:-bge-m3}" "OLLAMA_BASE_URL=$endpoint")
      ;;
    openai)
      key="$(sed -n 's/^OPENAI_API_KEY=//p' "$file" | head -n 1)"
      [[ -n "$key" && "$key" != *[[:space:]]* ]] || { echo "OpenAI embedding key missing or invalid" >&2; return 2; }
      if [[ -z "$model" ]]; then model="$(sed -n 's/^OPENAI_EMBEDDING_MODEL=//p' "$file" | head -n 1)"; fi
      restore_embedding_env+=("ORACLE_EMBEDDER=openai" "ORACLE_EMBEDDING_MODEL=${model:-text-embedding-3-small}" "OPENAI_API_KEY=$key")
      ;;
    *) echo "unsupported restore embedding provider" >&2; return 2 ;;
  esac
}
