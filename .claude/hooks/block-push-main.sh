#!/usr/bin/env bash
# PreToolUse(Bash) guard — block `git push` that targets the `main` branch.
# Rationale (CLAUDE.md release policy): pushing/merging to `main` triggers a
# STABLE CalVer release via calver-release.yml. Routine work must go to the
# `alpha` branch (pre-release). main is gated to explicit user direction only.
# Exit 2 = block the tool call; stderr is shown to the model as the reason.

input=$(cat)

cmd=$(printf '%s' "$input" | python3 -c 'import sys,json;
try:
    print(json.load(sys.stdin).get("tool_input",{}).get("command",""))
except Exception:
    print("")' 2>/dev/null)

# Only care about git push invocations.
printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])git[[:space:]]+push' || exit 0

reason="BLOCKED: this repo's release policy forbids pushing to 'main' (it triggers a STABLE release via calver-release.yml). Push feature work to the 'alpha' branch instead. If a stable release is genuinely intended, the user must do it explicitly."

# 1) Explicit main target: `git push origin main`, `HEAD:main`, `refs/heads/main`, `:main`
if printf '%s' "$cmd" | grep -qE '(^|[[:space:]:/])main([[:space:]]|$|:)'; then
  echo "$reason" >&2
  exit 2
fi

# 2) Bare `git push` / `git push origin` / `git push -u origin` with NO explicit
#    refspec, while the current branch is main → would push main.
cur=$(git -C "${CLAUDE_PROJECT_DIR:-.}" branch --show-current 2>/dev/null)
if [ "$cur" = "main" ]; then
  echo "$reason (current branch is 'main')" >&2
  exit 2
fi

exit 0
