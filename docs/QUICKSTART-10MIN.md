# 10-minute quickstart: Docker → `arra mine` → ask

This is the non-dev path for a first local Oracle memory. It starts the HTTP
server in Docker, runs the bundled `arra` CLI inside that same container, mines a
notes folder, and asks a cited question. No schema, collection, vector provider,
embedding provider, local Bun install, or LLM key is required: `arra mine`
derives project/concepts from the folder and `ask` uses local extractive answers
here.

## 0. Requirements

- Docker
- `curl`
- A folder of Markdown, MDX, or text notes. The examples use `~/notes`.

## 1. Start Arra Oracle

```bash
export ARRA_PORT="${ARRA_PORT:-47778}"
export ARRA_URL="http://127.0.0.1:${ARRA_PORT}"
export ARRA_IMAGE="${ARRA_IMAGE:-ghcr.io/soul-brews-studio/arra-oracle-v3:http}"
export ARRA_VOLUME="${ARRA_VOLUME:-arra-oracle-data}"
export ARRA_CONTAINER="${ARRA_CONTAINER:-arra-oracle}"
export ARRA_NOTES_DIR="${ARRA_NOTES_DIR:-$HOME/notes}"

mkdir -p "$ARRA_NOTES_DIR"
docker volume create "$ARRA_VOLUME" >/dev/null

docker run --rm -d --name "$ARRA_CONTAINER" \
  -p "${ARRA_PORT}:47778" \
  -v "${ARRA_VOLUME}:/data" \
  -v "${ARRA_NOTES_DIR}:${ARRA_NOTES_DIR}:ro" \
  "$ARRA_IMAGE"

until curl -sf "${ARRA_URL}/api/health" >/dev/null; do sleep 1; done
echo "Arra Oracle is ready at ${ARRA_URL}"
```

If port `47778` is busy, run `export ARRA_PORT=47878` first and repeat the block.
If your notes live somewhere else, set `ARRA_NOTES_DIR=/path/to/notes` before the
`docker run` block and mine that path instead.

## 2. Add the `arra` helper

This shell helper runs the bundled CLI inside the already-running container, so
`arra mine` writes to the same `/data` volume the server is using.

```bash
arra() {
  docker exec "$ARRA_CONTAINER" bun dist-cli/index.js "$@"
}
```

## 3. Mine your notes

```bash
arra mine ~/notes
```

Re-running is safe: unchanged files are skipped with deterministic IDs. Vector
indexing can stay off; FTS works immediately in SQLite-only mode.

For a clean demo if you do not have notes yet:

```bash
cat > ~/notes/arra-demo.md <<'NOTE'
# Family recipes

The cardamom chai ratio is two crushed pods per mug, simmered for five minutes.
NOTE
arra mine ~/notes
```

## 4. Ask a grounded question

```bash
curl -sfS "${ARRA_URL}/api/v1/ask" \
  -H 'content-type: application/json' \
  -d '{"q":"What is the cardamom chai ratio?","limit":5,"llm":false}'
```

Expected result: JSON with an `answer`, `citations`, and `sources`. Because the
request sends `"llm": false`, the answer is extractive and local; no provider key
or vector service is needed.

## Verified command path

The #2420 path was smoke-tested from a clean data volume with a local image built
from this checkout:

| Step | Evidence |
| --- | --- |
| `docker run` | `/api/health` returned OK on the mapped port. |
| `arra mine ~/notes` | `Mined 1 document from 1 file (0 skipped)` into project `notes`. |
| `curl /api/v1/ask` | Response had `"noEvidence": false` and cited `two crushed pods per mug`. |

## Stop or restart later

```bash
docker stop "${ARRA_CONTAINER:-arra-oracle}"
```

Restart by re-running the `docker run` block. Your memory remains in the Docker
volume named by `$ARRA_VOLUME`.

_Tracks the onboarding goal in #2420: Docker first, then `arra mine ~/notes`,
then ask with zero schema/provider choices._
