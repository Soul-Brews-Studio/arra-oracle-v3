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
uv run --quiet --with pyyaml --with jsonschema --with referencing --with sqlglot \
  python -I validation/validate.py "$DOC" --schema ontology/ontology.json
