module.exports = {
  apps: [{
    name: 'trekker-wabot',
    script: 'backend/server.js',
    cwd: '/app',
    instances: 1,
    autorestart: true,
    watch: false,
    min_uptime: '10s',
    env: {
      NODE_ENV: 'production'
    }
  }]
}
