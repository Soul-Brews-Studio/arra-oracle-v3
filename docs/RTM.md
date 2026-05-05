# Requirements Traceability Matrix — arra-oracle-v3

**Version:** 1.1.0
**Date:** 2026-05-05
**Status:** Populated with real data

---

## Traceability Table

| REQ-ID | Description | SRS § | SDD § | Code Files | Test Files | PR |
|--------|-------------|-------|-------|------------|------------|-----|
| REQ-AUTH-001 | Session auth (login/logout/status) | 3 AUTH | 3.3 | `src/routes/auth/login.ts`, `logout.ts`, `status.ts` | `tests/http/auth-settings.test.ts` | #885 |
| REQ-SETTINGS-001 | System settings get/update | 3 SETTINGS | 3.3 | `src/routes/settings/get.ts`, `update.ts` | `tests/http/auth-settings.test.ts` | #885 |
| REQ-SEARCH-001 | Hybrid search (FTS5 + vector) | 3 SEARCH-001 | 3.1 | `src/routes/search/search.ts`, `src/tools/search.ts` | `tests/http/core.test.ts`, `src/tools/__tests__/search.test.ts` | #884 |
| REQ-SEARCH-002 | Browse, map, map3d | 3 SEARCH-002 | 3.1 | `src/routes/search/list.ts`, `map.ts`, `map3d.ts` | `tests/http/core.test.ts` | #884 |
| REQ-SEARCH-003 | Reflect + similar discovery | 3 SEARCH-003 | 3.1 | `src/routes/search/reflect.ts`, `similar.ts` | `tests/http/compare.test.ts` | #884 |
| REQ-COMPARE-001 | Document comparison + agreement | 3 COMPARE | 3.1 | `src/routes/compare/compare.ts`, `agreement.ts` | `tests/http/compare.test.ts` | #939 |
| REQ-HEALTH-001 | Health check + diagnostics | 3 HEALTH | 3.2 | `src/routes/health/health.ts`, `oracles.ts` | `tests/http/core.test.ts` | #882, #900 |
| REQ-HEALTH-002 | Stats (doc count, index status) | 3 HEALTH | 3.2 | `src/routes/health/stats.ts` | `tests/http/core.test.ts` | #882 |
| REQ-FEED-001 | Activity feed create/list | 3 FEED | 3.4 | `src/routes/feed/create.ts`, `list.ts` | `tests/http/core.test.ts` | #885 |
| REQ-KNOWLEDGE-001 | Learn/ingest knowledge | 3 KNOWLEDGE | 3.5 | `src/routes/knowledge/learn.ts`, `src/tools/learn.ts` | `tests/http/knowledge.test.ts`, `src/tools/__tests__/learn.test.ts` | #884 |
| REQ-KNOW-002 | Handoff between sessions | 3 KNOWLEDGE | 3.5 | `src/routes/knowledge/handoff.ts`, `src/tools/handoff.ts` | `tests/http/knowledge.test.ts` | #884 |
| REQ-KNOW-003 | Inbox inter-oracle comms | 3 KNOWLEDGE | 3.5 | `src/routes/knowledge/inbox.ts`, `src/tools/inbox.ts` | `tests/http/knowledge.test.ts` | #884 |
| REQ-SUPERSEDE-001 | Document versioning (never delete) | 3 SUPERSEDE | 3.8 | `src/routes/supersede/create.ts`, `list.ts`, `chain.ts` | `tests/http/core.test.ts` | #884 |
| REQ-FORUM-001 | Threaded discussion CRUD | 3 FORUM | 3.6 | `src/routes/forum/thread-create.ts`, `thread-get.ts`, `threads-list.ts` | `tests/http/forum-traces.test.ts` | #883 |
| REQ-TRACES-001 | Audit trace links | 3 TRACES | 3.7 | `src/routes/traces/link.ts`, `unlink.ts`, `chain.ts`, `get.ts`, `list.ts` | `tests/http/forum-traces.test.ts` | #883, #891 |
| REQ-SCHEDULE-001 | Task scheduling CRUD + export | 3 SCHEDULE | 3.10 | `src/routes/schedule/create.ts`, `list.ts`, `update.ts`, `md.ts` | `src/tools/__tests__/schedule.test.ts` | #883 |
| REQ-DASHBOARD-001 | Dashboard analytics | 3 DASHBOARD | 3.11 | `src/routes/dashboard/activity.ts`, `growth.ts`, `summary.ts`, `session-stats.ts` | `tests/http/core.test.ts` | #882 |
| REQ-ORACLENET-001 | Federation (feed/presence/status) | 3 ORACLENET | 3.12 | `src/routes/oraclenet/feed.ts`, `presence.ts`, `status.ts`, `oracles.ts` | `tests/http/core.test.ts` | #882 |
| REQ-FILES-001 | File browsing + context | 3 FILES | 3.13 | `src/routes/files/file.ts`, `read.ts`, `context.ts`, `doc.ts`, `graph.ts` | `tests/http/files-plugins.test.ts` | #886 |
| REQ-PLUGINS-001 | Plugin registry | 3 PLUGINS | 3.14 | `src/routes/plugins/list.ts`, `get-by-name.ts` | `tests/http/files-plugins.test.ts`, `tests/cli/plugin/` | #886 |
| REQ-SESSIONS-001 | Session summary | 3 SESSIONS | 3.12 | `src/routes/sessions/summary.ts` | `tests/http/core.test.ts` | #882 |
| REQ-MENU-001 | Navigation menu (DB-backed) | 3 MENU | 3.9 | `src/routes/menu/menu.ts`, `admin.ts`, `custom.ts`, `studio-href.ts`, `studio-tag.ts` | `tests/http/menu/*.test.ts`, `src/routes/menu/__tests__/menu-phase3.test.ts` | #902–#945 |
| REQ-SEC-001 | Input sanitization (XSS, control chars) | 4.2 | 3.15 | `src/server/handlers.ts` | `tests/http/core.test.ts` | — |
| REQ-SEC-002 | UTF-8 safe response encoding | 4.2 | 3.15 | `src/server/handlers.ts` | `tests/http/core.test.ts` | — |

---

## Coverage Summary

| Category | REQs | Code ✅ | Tests ✅ | PR ✅ | Coverage |
|----------|------|---------|----------|-------|----------|
| Auth & Settings | 2 | 2 | 2 | 2 | 100% |
| Search & Compare | 4 | 4 | 4 | 3 | 100% |
| Health | 2 | 2 | 2 | 2 | 100% |
| Feed | 1 | 1 | 1 | 1 | 100% |
| Knowledge | 3 | 3 | 3 | 3 | 100% |
| Supersede | 1 | 1 | 1 | 1 | 100% |
| Forum & Traces | 2 | 2 | 2 | 2 | 100% |
| Schedule | 1 | 1 | 1 | 1 | 100% |
| Dashboard | 1 | 1 | 1 | 1 | 100% |
| OracleNet & Sessions | 2 | 2 | 2 | 2 | 100% |
| Files & Plugins | 2 | 2 | 2 | 2 | 100% |
| Menu | 1 | 1 | 1 | 1 | 100% |
| Security | 2 | 2 | 2 | 0 | Code+Test ✅ |
| **Total** | **24** | **24** | **24** | **22** | **100% code+test** |

---

## Change Log

| Version | Date | Author | Notes |
|---------|------|--------|-------|
| 1.0.0 | 2026-05-05 | Soul Brews Studio | Initial RTM — 21 requirements |
| 1.1.0 | 2026-05-05 | Soul Brews Studio | Populated with real code paths, test files, PR SHAs. Added REQ-SETTINGS-001, REQ-COMPARE-001, REQ-SESSIONS-001 from SRS |
