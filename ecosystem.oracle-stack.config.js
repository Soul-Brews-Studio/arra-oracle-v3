// PM2 ecosystem for the local Oracle stack.
// Usage:
//   pm2 start ecosystem.oracle-stack.config.js
//   pm2 restart oracle-backend
//   pm2 logs oracle-backend --lines 50
//   pm2 status
//   pm2 save        # persist across reboots (one-time, after pm2 startup)
//
// Watch mode is on for dev — saves on file change.
// Set NODE_ENV=production to disable watch.
//
// All paths assumed relative to the user's standard workspace; override via ARRA_REPO env.

const ARRA_REPO = process.env.ARRA_REPO || '/Users/nat/Code/github.com/Soul-Brews-Studio/arra-oracle-v3';
const UI_REPO = process.env.UI_REPO || '/Users/nat/Code/github.com/Soul-Brews-Studio/ui-oracle';

const watch = process.env.NODE_ENV === 'production' ? false : true;

module.exports = {
  apps: [
    {
      name: 'oracle-backend',
      cwd: ARRA_REPO,
      script: 'bun',
      args: 'src/server.ts',
      env: {
        ORACLE_PORT: '47778',
      },
      autorestart: true,
      watch: watch ? ['src'] : false,
      ignore_watch: ['node_modules', '*.log', '.git', 'dist', '*.test.ts'],
      max_memory_restart: '1G',
      time: true,
    },

    {
      name: 'oracle-indexer',
      cwd: ARRA_REPO,
      script: 'bun',
      args: 'src/indexer/daemon.ts',
      env: {
        INDEXER_PORT: '47779',
      },
      autorestart: true,
      watch: false,
      time: true,
    },

    {
      name: 'oracle-reranker',
      cwd: `${ARRA_REPO}/services/reranker-py`,
      script: 'uv',
      args: 'run uvicorn main:app --host 127.0.0.1 --port 8765',
      autorestart: true,
      watch: false,
      time: true,
    },

    {
      name: 'oracle-ui',
      cwd: UI_REPO,
      script: 'bun',
      args: '--cwd apps/studio dev',
      autorestart: true,
      watch: false,
      time: true,
    },
  ],
};
