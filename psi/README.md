# Project Maintenance Vault

This `psi/` directory is for maintaining the `arra-oracle` / `arra-oracle-v3`
repository.

`arra-oracle` is the Oracle memory/API core. This vault records maintainer
handoffs, decisions, readouts, and project-specific learnings. It is not the
Oracle runtime database, not an indexed knowledge store, and not a task queue.

## Rules

- GitHub Issues and pull requests are the durable queue.
- This vault is memory and handoff, not a task claim system.
- Do not store secrets, tokens, API keys, `.env` files, generated databases,
  vector indexes, cache directories, or service runtime state.
- Keep API, CLI, MCP, and indexing changes in their source directories with
  normal tests and review.
- Use this vault only for project maintenance context.

## Structure

```text
psi/
  active/     current maintainer context and checkpoints
  handoff/    session handoffs for future maintainers
  decisions/  project decisions, reversals, and rationale
  learn/      repo readouts, proofs, and investigations
  memory/     durable project learnings and retrospectives
```
