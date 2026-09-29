#!/usr/bin/env bash
set -Eeuo pipefail

usage() { echo "usage: $0 --archive FILE --identity FILE --target DIR"; }
archive=""; identity=""; target=""
while (($#)); do
  case "$1" in
    --archive) archive="${2:?}"; shift 2 ;;
    --identity) identity="${2:?}"; shift 2 ;;
    --target) target="${2:?}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done
[[ -s "$archive" && -r "$archive" ]] || { echo "encrypted archive is unreadable" >&2; exit 2; }
[[ -s "$identity" && -r "$identity" ]] || { echo "age identity is unreadable" >&2; exit 2; }
[[ -n "$target" && ! -e "$target" && ! -L "$target" ]] || { echo "restore target must be a new path" >&2; exit 2; }
command -v age >/dev/null || { echo "age is required" >&2; exit 2; }
command -v tar >/dev/null || { echo "tar is required" >&2; exit 2; }

tmp="$(mktemp -d "${TMPDIR:-/tmp}/arra-private-restore.XXXXXX")"
cleanup() { rm -r -- "$tmp"; }
trap cleanup EXIT
mkdir -p "$target"
age -d -i "$identity" "$archive" > "$tmp/archive.tar.gz"
if tar -tzf "$tmp/archive.tar.gz" | awk 'BEGIN { bad=0 } index($0,"/")==1 || index($0,"../")==1 || index($0,"/../")>0 { bad=1 } END { exit bad }'; then :; else
  echo "restore archive contains an unsafe path" >&2
  exit 1
fi
if tar -tvzf "$tmp/archive.tar.gz" | awk '$1 ~ /^l/ { bad=1 } END { exit bad }'; then :; else
  echo "restore archive contains a symlink; refusing ambiguous extraction" >&2
  exit 1
fi
tar --no-same-owner --no-same-permissions -xzf "$tmp/archive.tar.gz" -C "$target"
[[ -f "$target/checksums.sha256" && -f "$target/data/oracle.db" && -f "$target/deployment/backup-manifest.json" \
  && -f "$target/deployment/corpus.manifest.json" && -f "$target/corpus/snapshot-manifest.json" \
  && -f "$target/deployment/vector-server.json" && -f "$target/deployment/source-coverage.json" ]] || {
  echo "restore archive missing required state" >&2
  exit 1
}
SOURCE_COVERAGE="$target/deployment/source-coverage.json" bun -e 'const c=await Bun.file(process.env.SOURCE_COVERAGE).json(); if (c.covered !== true || !Array.isArray(c.files) || !Array.isArray(c.documents) || c.uncovered?.length) process.exit(1);' || {
  echo "restore source coverage is incomplete" >&2
  exit 1
}
if find "$target/data" "$target/vector" "$target/deployment" "$target/corpus" -type l -print -quit 2>/dev/null | grep -q .; then
  echo "restore target contains an unexpected symlink" >&2
  exit 1
fi
MANIFEST="$target/deployment/backup-manifest.json" bun -e 'const m=await Bun.file(process.env.MANIFEST).json(); if (m.commit === "unknown" || m.authorityQuiesced !== true || m.secretIncluded !== false) process.exit(1);' || {
  echo "restore manifest is not a verified private/quiesced backup" >&2
  exit 1
}
(cd "$target" && if command -v sha256sum >/dev/null; then sha256sum -c checksums.sha256; else shasum -a 256 -c checksums.sha256; fi)
echo "isolated restore verified: $target"
