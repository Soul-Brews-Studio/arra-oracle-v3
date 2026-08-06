// PM2 backend runbook for the local Oracle server.
//
// Usage:
//   pm2 start ecosystem.config.cjs --only arra-oracle
//   pm2 restart arra-oracle --update-env
//   pm2 save
//
// Defaults intentionally preserve the #2674 live-server fix:
// unset ORACLE_EMBEDDER auto-starts with Ollama; explicit "none" stays disabled.

const os = require('node:os');
const path = require('node:path');

const repoRoot = process.env.ARRA_REPO || __dirname;
const port = process.env.ORACLE_PORT || process.env.PORT || '47778';

module.exports = {
  apps: [
    {
      name: 'arra-oracle',
      cwd: repoRoot,
      script: 'bun',
      args: 'run server',
      interpreter: 'none',
      env: {
        NODE_ENV: process.env.NODE_ENV || 'development',
        ORACLE_PORT: port,
        PORT: port,
        ORACLE_DATA_DIR: process.env.ORACLE_DATA_DIR || path.join(os.homedir(), '.arra-oracle-v2'),
        ORACLE_EMBEDDER: process.env.ORACLE_EMBEDDER || 'ollama',
      },
      autorestart: true,
      watch: false,
      time: true,
      max_memory_restart: '1G',
    },
  ],
};
