#!/bin/bash
# Migrate ~/.oracle/ → ~/.arra-oracle-v2/
# "Nothing is Deleted" — old dir preserved, not removed.

OLD="$HOME/.oracle"
NEW="$HOME/.arra-oracle-v2"

if [ -d "$NEW" ]; then
  echo "✓ $NEW already exists — nothing to do"
  exit 0
fi

if [ ! -d "$OLD" ]; then
  echo "⚠ $OLD not found — creating fresh $NEW"
  mkdir -p "$NEW"
  exit 0
fi

echo "Migrating $OLD → $NEW..."
cp -r "$OLD" "$NEW"
echo "✓ Migrated $OLD → $NEW"
echo "  Old dir preserved at $OLD (Nothing is Deleted)"
