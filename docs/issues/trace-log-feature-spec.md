# Trace Log — as-built spec

Issue: Traceable discovery system. This document replaces the earlier
aspirational trace plan with the current `alpha` implementation checked against
`src/routes/traces/*`, `src/trace/*`, `src/tools/*`, and `src/db/schema.ts`.

## AS-BUILT table

| Area | Shipped | Source of truth | Notes |
| --- | --- | --- | --- |
| Storage | `trace_log` Drizzle table | `src/db/schema.ts` | Includes `tenant_id`, dig-point JSON fields, parent/child IDs, prev/next chain IDs, status, awakening, and distillation fields. |
| Create trace | `POST /api/traces` | `src/routes/traces/create.ts`, `src/trace/store.ts` | Requires non-empty `query`; returns `traceId`, depth, and dig-point counts. |
| List traces | `GET /api/traces` | `src/routes/traces/list.ts` | Supports query/status/project plus bounded pagination. |
| Read trace | `GET /api/traces/:id` | `src/routes/traces/get.ts` | Tenant-scoped lookup through route helpers. |
| Chain reads | `GET /api/traces/:id/chain`, `GET /api/traces/:id/linked-chain` | `src/routes/traces/chain.ts`, `linked-chain.ts` | Supports recursive trace navigation without a separate dig tool. |
| Link edits | `POST /api/traces/:id/link`, `DELETE /api/traces/:id/link` | `src/routes/traces/link.ts`, `unlink.ts` | Explicit prev/next links. |
| Distillation | `POST /api/traces/:id/distill` | `src/routes/traces/distill.ts`, `src/trace/distill.ts` | Requires `awakening`; can promote to learning. |
| MCP tools | `oracle_trace`, `oracle_trace_list`, `oracle_trace_get`, `oracle_trace_link`, `oracle_trace_unlink`, `oracle_trace_chain`, `oracle_trace_distill` | `src/tools/trace.ts`, `src/tools/oracle.ts`, `src/tools/mcp-rest-map.ts` | All remoteable over the HTTP proxy map. |
| Not implemented | `oracle_trace_dig` | no source match | Do not advertise it as shipped; file reading belongs to existing read/search tools or future scoped design. |

## Current route contract

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/traces` | Create one trace from discovered files, commits, issues, learnings, and context. |
| `GET` | `/api/traces` | List recent traces with filters. |
| `GET` | `/api/traces/:id` | Read one trace. |
| `GET` | `/api/traces/:id/chain` | Read parent/child chain. |
| `GET` | `/api/traces/:id/linked-chain` | Read explicit prev/next linked chain. |
| `POST` | `/api/traces/:id/link` | Link this trace to a next trace. |
| `DELETE` | `/api/traces/:id/link` | Remove a prev/next link. |
| `POST` | `/api/traces/:id/distill` | Store an awakening and optionally promote it to learning memory. |

## Current MCP contract

- `oracle_trace` logs the session with dig-point arrays and project/session
  metadata.
- `oracle_trace_list` searches trace summaries.
- `oracle_trace_get` fetches one trace and can route to the chain variant when
  proxy input asks for chain context.
- `oracle_trace_link` and `oracle_trace_unlink` maintain explicit trace chains.
- `oracle_trace_chain` reads linked context for recursive discovery.
- `oracle_trace_distill` writes the distilled awakening; it is the shipped
  replacement for the old aspirational dig-to-distill path.

## Planned / not shipped

| Item | Status | Current guidance |
| --- | --- | --- |
| `oracle_trace_dig` | Not implemented | Do not document as a live MCP tool. Re-open only with file-scope, auth, and tenant rules. |
| `/dig` command integration | Not implemented in this repo | Use existing `oracle_read`, search, and trace-chain tools. |
| Nat-s-Agents `/trace` auto-log | External integration, not an Arra route | Keep repo docs focused on Arra APIs. |
| Trace dashboard UI | Not covered by current route tests | Treat as future Studio work, not current acceptance. |
| Cross-Oracle trace merge | Planned only | Requires explicit federation/tenant contract first. |

## Verification

```bash
grep -R "oracle_trace_dig" src tests
grep -R "oracle_trace_distill" src/tools src/routes tests
bun test src/server/__tests__/trace-create-route.test.ts \
  src/trace/__tests__/chain-cycle.test.ts \
  src/trace/__tests__/distill-edge.test.ts \
  tests/mcp/http-proxy-posts-trace-distill.test.ts
bunx tsc --noEmit
```

Expected source result: no shipped `oracle_trace_dig` implementation; shipped
trace create/list/get/link/unlink/chain/distill routes and MCP proxy mappings.
