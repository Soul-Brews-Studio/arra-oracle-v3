# Contributing

## Repository topology and PR targets

Arra uses two GitHub repositories with different jobs:

- **`Soul-Brews-Studio/arra-oracle-v3`** is the published source package. Code that ships via npm/bunx/GHCR belongs here.
- **`Soul-Brews-Studio/arra-oracle-v3-oracle`** is the Oracle identity repo: ψ vault, agent worktrees, and issue tracker live there.

When a change touches shipped code, always create the PR against the source repository and the alpha branch:

```bash
gh pr create --repo Soul-Brews-Studio/arra-oracle-v3 --base alpha
```

Tracking issues may still live in `arra-oracle-v3-oracle`. Reference them with a fully qualified closer so GitHub links the right issue from the source PR:

```text
Closes Soul-Brews-Studio/arra-oracle-v3-oracle#N
```

### Split-brain red flags

- A code PR with a low PR number, such as `#9` instead of the source repo's four-digit PR series, probably went to the wrong repository.
- Agent worktrees such as `agents/1-codex-N` can inherit the `arra-oracle-v3-oracle` origin. Do not rely on `gh pr create` defaults from those worktrees; pass `--repo Soul-Brews-Studio/arra-oracle-v3` explicitly.
- If a PR changes files under the Oracle identity/vault repo but intends to ship runtime, CLI, MCP, Docker, or package code, stop and recreate it in `arra-oracle-v3` targeting `alpha`.
