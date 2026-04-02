/**
 * ecosystem.config.js — PM2 process configuration
 *
 * Start both processes: pm2 start ecosystem.config.js
 * Or individually:     pm2 start ecosystem.config.js --only irrigation-poll
 */

module.exports = {
  apps: [
    {
      name: 'irrigation-poll',
      script: 'poll.js',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      out_file: './logs/poll-out.log',
      error_file: './logs/poll-error.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'irrigation-server',
      script: 'server.js',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      out_file: './logs/server-out.log',
      error_file: './logs/server-error.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
    },
  ],
};
