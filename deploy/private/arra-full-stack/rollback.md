# Rollback runbook

Critical rollback trigger: any failed health/auth/plugin/vector/ask/MCP gate,
unexpected write outside the curated manifest, or no green health within 15
minutes of cutover. The data snapshot and runtime manifest are rolled back
together; never run the old binary against a migrated live database.

1. Stop new Arra and adapter writers; preserve their logs and failed stage.
2. Keep the last verified encrypted age bundle immutable. Decrypt to a new
   isolated target and verify checksums before touching the authority.
3. Restore the last known-good database, vector state, curated-source snapshot,
   and non-secret runtime manifest. Reapply the existing Mint auth token from
   its protected source; never restore a secret from the bundle.
4. Start the pinned previous Arra binary with workers disabled and FTS-only
   config. Prove health, search/read, MCP, and tunnel connectivity.
5. Re-enable normal backup/health monitoring. Treat writes made after the last
   good snapshot as unmerged review material; do not silently overwrite them.
