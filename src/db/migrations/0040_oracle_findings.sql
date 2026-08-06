CREATE TABLE IF NOT EXISTS oracle_findings (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  subject TEXT NOT NULL,
  relation TEXT,
  object TEXT,
  dug_by TEXT NOT NULL,
  as_of_ts INTEGER NOT NULL,
  as_of_commit TEXT,
  confidence REAL NOT NULL,
  topic TEXT,
  friction_score REAL,
  commissioned_by TEXT,
  iterations INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS oracle_finding_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  finding_id TEXT NOT NULL REFERENCES oracle_findings(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  kind TEXT NOT NULL,
  github_owner TEXT,
  github_repo TEXT,
  github_path TEXT,
  github_ref TEXT,
  github_line INTEGER,
  session_id TEXT,
  session_oracle TEXT,
  oracle_msg_from TEXT,
  oracle_msg_at INTEGER,
  web_url TEXT,
  web_fetched_at INTEGER,
  "commit" TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_findings_tenant ON oracle_findings (tenant_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_findings_subject ON oracle_findings (subject);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_findings_topic ON oracle_findings (topic);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_findings_dug_by ON oracle_findings (dug_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_evidence_finding ON oracle_finding_evidence (finding_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_evidence_kind ON oracle_finding_evidence (kind);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_evidence_github ON oracle_finding_evidence (github_owner, github_repo, github_path);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_evidence_session ON oracle_finding_evidence (session_id);
