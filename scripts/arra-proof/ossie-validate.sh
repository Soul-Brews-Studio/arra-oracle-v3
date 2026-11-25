#!/usr/bin/env bash
# Validate the arra memory ontology with the official Apache Ossie validator (#3110 graph view).
#
#   bash scripts/arra-proof/ossie-validate.sh                 # ontology straight from the code
#   ORACLE_API=http://127.0.0.1:47778 bash scripts/arra-proof/ossie-validate.sh   # from a running arra
#
# Needs git, uv (Python deps run in a throwaway env) and bun. Uses apache/ossie at OSSIE_REF.
set -euo pipefail
OSSIE_REF=${OSSIE_REF:-d27a6be}
WORK=${WORK:-${TMPDIR:-/tmp}/arra-ossie}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$WORK"
if [ ! -d "$WORK/ossie/.git" ]; then git clone -q https://github.com/apache/ossie "$WORK/ossie"; fi
git -C "$WORK/ossie" fetch -q origin && git -C "$WORK/ossie" checkout -q "$OSSIE_REF"
echo "apache/ossie $(git -C "$WORK/ossie" log -1 --format='%h %ad %s' --date=short)"

DOC="$WORK/arra.ontology.json"
if [ -n "${ORACLE_API:-}" ]; then
  curl -fsS "$ORACLE_API/api/v1/arra/ontology?format=ossie" -o "$DOC"
  echo "ontology from GET $ORACLE_API/api/v1/arra/ontology?format=ossie"
else
  (cd "$ROOT" && bun -e 'import { arraOntology } from "./src/arra/ontology.ts"; console.log(JSON.stringify(arraOntology(), null, 2))') > "$DOC"
  echo "ontology from src/arra/ontology.ts"
fi
cd "$WORK/ossie"
RC=0
uv run --quiet --with pyyaml --with jsonschema --with referencing --with sqlglot \
  python -I validation/validate.py "$DOC" --schema ontology/ontology.json || RC=$?

# Record the result where the hub's Topology view reads it (<data dir>/ossie-validation.json).
# RECORD=<file> overrides; with neither RECORD nor ORACLE_DATA_DIR set nothing is written.
RECORD=${RECORD:-${ORACLE_DATA_DIR:+$ORACLE_DATA_DIR/ossie-validation.json}}
if [ -n "$RECORD" ]; then
  REF=$(git -C "$WORK/ossie" rev-parse --short HEAD)
  FROM=$([ -n "${ORACLE_API:-}" ] && echo api || echo code)
  (cd "$ROOT" && DOC="$DOC" RC="$RC" REF="$REF" FROM="$FROM" OUT="$RECORD" bun -e '
    const { ossieHash } = await import("./src/arra/ossie-check.ts");
    const doc = JSON.parse(await Bun.file(process.env.DOC).text());
    const rec = { at: new Date().toISOString(), passed: process.env.RC === "0", ossieRef: process.env.REF, sha256: ossieHash(doc), from: process.env.FROM };
    await Bun.write(process.env.OUT, JSON.stringify(rec, null, 2) + "\n");
    console.log(`recorded ${rec.passed ? "PASSED" : "FAILED"} -> ${process.env.OUT}`);')
fi
exit "$RC"
