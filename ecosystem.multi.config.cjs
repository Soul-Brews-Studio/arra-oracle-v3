// PM2 multi-instance runbook — run SEVERAL Oracle servers from ONE checkout.
//
// Same code, different runtime env → different port + data dir. No separate
// clone needed (config is fully env-driven: ORACLE_PORT + ORACLE_DATA_DIR).
// Each instance is fully isolated by its data dir; the shared one is untouched
// by the others. curl / on each shows its own config.port + config.dataDir.
//
// Usage:
//   pm2 start ecosystem.multi.config.cjs                 # start all instances
//   pm2 start ecosystem.multi.config.cjs --only arra-oracle-muninn
//   pm2 restart arra-oracle --update-env                 # pick up new env / new code after git pull
//   pm2 save
//
// Update flow (all instances share this checkout):
//   git pull origin alpha && pm2 restart all --update-env
//
// Preserves the #2674 live-server fix: ORACLE_EMBEDDER unset/"ollama" auto-starts
// with Ollama; explicit "none" disables the embedder (FTS5-only).
//
// To add an instance: copy a block, give it a unique name + ORACLE_PORT +
// ORACLE_DATA_DIR. To point one at a separate Ollama (so heavy embedding/index
// work doesn't compete with the shared instance's live search), set
// ORACLE_EMBEDDER_URL on that block only.

const os = require('node:os');
const path = require('node:path');

const repoRoot = process.env.ARRA_REPO || __dirname;
const home = os.homedir();

// One instance = one { name, port, dataDir, [embedderUrl] }.
function instance({ name, port, dataDir, embedder = 'ollama', embedderUrl }) {
  const env = {
    NODE_ENV: process.env.NODE_ENV || 'development',
    ORACLE_PORT: String(port),
    PORT: String(port),
    ORACLE_DATA_DIR: dataDir,
    ORACLE_EMBEDDER: embedder,
  };
  if (embedderUrl) env.ORACLE_EMBEDDER_URL = embedderUrl;
  return {
    name,
    cwd: repoRoot,
    script: 'bun',
    args: 'run server',
    interpreter: 'none',
    env,
    autorestart: true,
    watch: false,
    time: true,
    max_memory_restart: '1G',
  };
}

module.exports = {
  apps: [
    // Shared fleet instance — the one every oracle's MCP arra-oracle points at.
    instance({
      name: 'arra-oracle',
      port: 47778,
      dataDir: path.join(home, '.arra-oracle-v2'),
    }),

    // muninn's separate instance — own data dir, fully isolated from shared.
    instance({
      name: 'arra-oracle-muninn',
      port: 47788,
      dataDir: path.join(home, '.arra-oracle-muninn'),
    }),

    // Example — a scratch instance pointed at a separate Ollama so a heavy
    // reindex/backfill doesn't compete with the shared instance's live search.
    // Uncomment + adjust to use.
    // instance({
    //   name: 'arra-oracle-index',
    //   port: 47798,
    //   dataDir: path.join(home, '.arra-oracle-v2'),        // same corpus to backfill
    //   embedderUrl: 'http://gpu-oracle:11434',             // separate embedder
    // }),
  ],
};
