module.exports = {
  apps: [
    {
      name: 'discimind-backend',
      cwd: '/opt/discimind/backend',
      script: 'src/server.js',
      instances: 1,
      exec_mode: 'fork',
      node_args: '--max-old-space-size=640',
      max_memory_restart: '750M',
      kill_timeout: 20000,
      listen_timeout: 15000,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s',
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        TRUST_PROXY: 'loopback',
      },
    },
  ],
}
