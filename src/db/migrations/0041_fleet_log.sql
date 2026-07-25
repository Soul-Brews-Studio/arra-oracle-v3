CREATE TABLE IF NOT EXISTS fleet_messages (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT DEFAULT 'default' NOT NULL,
  channel TEXT NOT NULL,
  source TEXT,
  direction TEXT,
  from_id TEXT,
  to_id TEXT,
  thread_key TEXT,
  text TEXT,
  raw TEXT,
  raw_path TEXT,
  ts INTEGER NOT NULL,
  ingested_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_fleet_msg_channel_ts ON fleet_messages (channel, ts);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_fleet_msg_from ON fleet_messages (from_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_fleet_msg_to ON fleet_messages (to_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_fleet_msg_thread ON fleet_messages (thread_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_fleet_msg_tenant_ts ON fleet_messages (tenant_id, ts);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS fleet_ingest_cursor (
  id TEXT PRIMARY KEY NOT NULL,
  last_cursor TEXT,
  last_run_at INTEGER,
  status TEXT DEFAULT 'idle' NOT NULL,
  error TEXT
);
