# User Acceptance Testing — arra-oracle-v3
**Document:** UAT-arra-oracle-v3-001 | **Standard:** IEEE 829 | **Date:** 2026-05-05  
**Testers:** Ember, Kati | **Base URL:** `http://localhost:47778`

---

## 1. Scope

End-to-end UAT for the arra-oracle-v3 HTTP API. All cases are executable via `curl` or a REST client (Hoppscotch, Postman). Precondition for most cases: server running on port 47778 with a seeded database.

---

## 2. Test Cases

### 2.1 Health / Stats

| UAT-ID | REQ-ID | Description | Preconditions | Steps | Expected Result | Status |
|---|---|---|---|---|---|---|
| UAT-001 | REQ-HEALTH-01 | API health check | Server running | `GET /health` | HTTP 200, `{"status":"ok"}` | Pending |
| UAT-002 | REQ-HEALTH-02 | Stats returns counters | At least one doc ingested | `GET /stats` | HTTP 200, contains `docs` count field | Pending |

---

### 2.2 Auth

| UAT-ID | REQ-ID | Description | Preconditions | Steps | Expected Result | Status |
|---|---|---|---|---|---|---|
| UAT-003 | REQ-AUTH-01 | Login with valid credentials | Valid username/password configured | `POST /auth/login` with `{"username":"<u>","password":"<p>"}` | HTTP 200, session token returned | Pending |
| UAT-004 | REQ-AUTH-02 | Session status shows authenticated | UAT-003 done, token stored | `GET /auth/status` with token header | HTTP 200, body indicates authenticated | Pending |
| UAT-005 | REQ-AUTH-03 | Logout invalidates session | UAT-003 done | 1. `POST /auth/logout` 2. `GET /auth/status` with same token | Logout 200; subsequent status 401 | Pending |

---

### 2.3 Search

| UAT-ID | REQ-ID | Description | Preconditions | Steps | Expected Result | Status |
|---|---|---|---|---|---|---|
| UAT-006 | REQ-SEARCH-01 | Hybrid search — English | At least one doc ingested | `GET /search?q=test` | HTTP 200, JSON array with title/content fields | Pending |
| UAT-007 | REQ-SEARCH-02 | Hybrid search — Thai content | Thai doc ingested (e.g., "ทดสอบระบบ") | `GET /search?q=ทดสอบ` | HTTP 200, Thai doc in results; `Content-Type: application/json; charset=utf-8` | Pending |
| UAT-008 | REQ-SEARCH-03 | Empty query handled gracefully | Server running | `GET /search?q=` | HTTP 200 or 400; no 500; graceful empty response | Pending |
| UAT-009 | REQ-SEARCH-04 | FTS matches keyword in body | Doc with word "oracle" ingested | `GET /search?q=oracle&mode=fts` | HTTP 200, result contains doc with "oracle" in content | Pending |
| UAT-010 | REQ-SEARCH-05 | Vector search — semantic similarity | Embeddings generated | `GET /search?q=knowledge+base&mode=vector` | HTTP 200, results ranked by semantic similarity | Pending |

---

### 2.4 Knowledge

| UAT-ID | REQ-ID | Description | Preconditions | Steps | Expected Result | Status |
|---|---|---|---|---|---|---|
| UAT-011 | REQ-KNOW-01 | Learn (ingest) a new document | Authenticated session | `POST /knowledge/learn` `{"title":"Test Doc","content":"Hello World"}` | HTTP 201, new document ID returned | Pending |
| UAT-012 | REQ-KNOW-02 | Handoff creates record | Auth session, UAT-011 done | `POST /knowledge/handoff` with payload | HTTP 200/201, handoff record created | Pending |
| UAT-013 | REQ-KNOW-03 | Inbox lists pending items | At least one item in inbox | `GET /knowledge/inbox` | HTTP 200, JSON array of inbox items | Pending |

---

### 2.5 Forum

| UAT-ID | REQ-ID | Description | Preconditions | Steps | Expected Result | Status |
|---|---|---|---|---|---|---|
| UAT-014 | REQ-FORUM-01 | Create forum thread | Authenticated session | `POST /forum/threads` `{"title":"UAT Thread","body":"Test"}` | HTTP 201, thread ID returned | Pending |
| UAT-015 | REQ-FORUM-02 | List forum threads | UAT-014 done | `GET /forum/threads` | HTTP 200, array includes new thread | Pending |
| UAT-016 | REQ-FORUM-03 | Get single thread by ID | UAT-014 done, ID stored | `GET /forum/threads/{id}` | HTTP 200, thread matches created data | Pending |

---

### 2.6 Feed

| UAT-ID | REQ-ID | Description | Preconditions | Steps | Expected Result | Status |
|---|---|---|---|---|---|---|
| UAT-017 | REQ-FEED-01 | Create feed event | Authenticated session | `POST /feed` `{"type":"update","payload":{"msg":"test"}}` | HTTP 201, event ID returned | Pending |
| UAT-018 | REQ-FEED-02 | List feed events | UAT-017 done | `GET /feed` | HTTP 200, array includes created event | Pending |

---

### 2.7 Menu

| UAT-ID | REQ-ID | Description | Preconditions | Steps | Expected Result | Status |
|---|---|---|---|---|---|---|
| UAT-019 | REQ-MENU-01 | List menu items | Menu data seeded | `GET /menu` | HTTP 200, JSON array of menu items | Pending |
| UAT-020 | REQ-MENU-02 | Create menu item | Authenticated session | `POST /menu` `{"label":"UAT Item","path":"/uat"}` | HTTP 201, item ID returned | Pending |
| UAT-021 | REQ-MENU-03 | Update menu item | UAT-020 done, ID stored | `PUT /menu/{id}` `{"label":"UAT Updated"}` | HTTP 200, label updated | Pending |
| UAT-022 | REQ-MENU-04 | Delete menu item | UAT-020 done | 1. `DELETE /menu/{id}` 2. `GET /menu/{id}` | DELETE 200/204; GET 404 | Pending |
| UAT-023 | REQ-MENU-05 | Reorder menu items | At least two items exist | `POST /menu/reorder` `{"order":[id2,id1]}` | HTTP 200; `GET /menu` returns new order | Pending |

---

### 2.8 Supersede

| UAT-ID | REQ-ID | Description | Preconditions | Steps | Expected Result | Status |
|---|---|---|---|---|---|---|
| UAT-024 | REQ-SUP-01 | New doc supersedes old | UAT-011 done, original ID stored | `POST /knowledge/learn` `{"title":"v2","content":"Updated","supersedes":"<orig-id>"}` | HTTP 201, new doc created | Pending |
| UAT-025 | REQ-SUP-02 | Old doc marked as superseded | UAT-024 done | `GET /knowledge/<orig-id>` | HTTP 200, `superseded_by` set to new ID or `status:"superseded"` | Pending |

---

### 2.9 Security

| UAT-ID | REQ-ID | Description | Preconditions | Steps | Expected Result | Status |
|---|---|---|---|---|---|---|
| UAT-026 | REQ-SEC-01 | XSS payload in search query | Server running | `GET /search?q=<script>alert(1)</script>` | HTTP 200/400; raw `<script>` not reflected unescaped; no 500 | Pending |
| UAT-027 | REQ-SEC-02 | SQL injection in search | Server running | `GET /search?q=' OR '1'='1` | HTTP 200/400; no 500; no DB error in response body | Pending |
| UAT-028 | REQ-SEC-03 | CORS headers present | Server running | `OPTIONS /health` with `Origin: http://example.com` | Response includes `Access-Control-Allow-Origin` header | Pending |

---

### 2.10 Accessibility / Encoding

| UAT-ID | REQ-ID | Description | Preconditions | Steps | Expected Result | Status |
|---|---|---|---|---|---|---|
| UAT-029 | REQ-ACC-01 | JSON endpoints return correct Content-Type | Server running | `GET /health` — inspect headers | `Content-Type: application/json` (charset utf-8 acceptable) | Pending |
| UAT-030 | REQ-ACC-02 | Thai content round-trips without corruption | Server running | 1. `POST /knowledge/learn` `{"title":"ทดสอบ","content":"เนื้อหาภาษาไทย"}` 2. `GET /knowledge/{id}` | Retrieved content matches exactly — no truncation or mojibake | Pending |

---

## 3. Regression Tests

### REG-001 — Elysia UTF-8 Content-Length Bug (Fixed)

**Root Cause:** Elysia calculated `Content-Length` using character count instead of byte count for multi-byte UTF-8 strings, causing Thai responses to be truncated. Fixed by returning a raw `Response` object instead of a plain string.

| UAT-ID | REQ-ID | Description | Preconditions | Steps | Expected Result | Status |
|---|---|---|---|---|---|---|
| UAT-REG-001 | REQ-REG-01 | Thai search response not truncated | Thai document ingested | 1. `GET /search?q=ไทย` 2. Compare `Content-Length` header vs actual body byte count | Body is complete and untruncated; `Content-Length` (if present) equals UTF-8 byte length | Pending |

### REG-002 — Control Characters in Content (Fixed)

**Root Cause:** Raw control characters (`\x00`–`\x1F`) embedded in stored content broke JSON serialization, causing 500 errors on retrieval. Fixed with `sanitizeContent` pre-processing on ingest.

| UAT-ID | REQ-ID | Description | Preconditions | Steps | Expected Result | Status |
|---|---|---|---|---|---|---|
| UAT-REG-002 | REQ-REG-02 | Control chars in content do not cause 500 | Server running | 1. `POST /knowledge/learn` with content containing `\t`, `\r`, or `\x01` chars 2. `GET /knowledge/{id}` | HTTP 201 on ingest; HTTP 200 on retrieval; content sanitized; no 500 | Pending |

---

## 4. Sign-off

| Tester | Date | Pass / Fail | Notes |
|---|---|---|---|
| Ember | | | |
| Kati | | | |

_End of document._
