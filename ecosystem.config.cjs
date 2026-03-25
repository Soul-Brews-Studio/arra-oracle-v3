module.exports = {
  apps: [{
    name: 'arra-oracle-v3',
    script: 'src/server.ts',
    interpreter: 'bun',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      ORACLE_PORT: 47778,
      ORACLE_REPO_ROOT: '/Users/jodunk/Documents/Project/volt-oracle',
    },
    error_file: '~/.pm2/logs/arra-oracle-v3-error.log',
    out_file: '~/.pm2/logs/arra-oracle-v3-out.log',
    log_file: '~/.pm2/logs/arra-oracle-v3-combined.log',
    time: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
  }],
};
