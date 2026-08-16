# Contributing

## Repository topology and PR targets

Arra uses two GitHub repositories with different jobs:

- **`Soul-Brews-Studio/arra-oracle-v3`** is the published source package. Code that ships via npm/bunx/GHCR belongs here — **and this is where the working ψ vault actually lives** (`arra-oracle-v3/ψ`).
- **`Soul-Brews-Studio/arra-oracle-v3-oracle`** is the Oracle identity repo: agent worktrees and the issue tracker. It also carries a ψ tree, but it is largely historical.

> **Which ψ is the real one?** `arra-oracle-v3/ψ`. Measured 2026-08-16: 4,463 `.md` files
> here versus 838 in `-oracle`, and 24 files touched since 2026-08-01 versus 4. This line
> previously said the vault lived in `-oracle`, which sent federation messages to an inbox
> nobody was reading — two oracles each followed a different source and were both "right".
> If you are writing to another oracle's inbox, target `arra-oracle-v3/ψ/inbox/`. See #2856.

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
