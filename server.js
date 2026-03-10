const instanceId = process.argv[2];

if (instanceId) {
  const { spawn } = require('child_process');
  const path = require('path');
  
  const botDir = path.join(__dirname, 'bot');
  const port = process.env.INSTANCE_PORT || process.argv[3] || '4000';
  const phoneNumber = process.argv[4] || '';
  
  // Spawn index.js in bot directory and pass instanceId as argument
  const proc = spawn('node', ['index.js', instanceId], {
    cwd: botDir,
    detached: true,
    stdio: 'inherit',
    env: process.env
  });
  
  proc.unref();
  console.log(`Starting bot instance ${instanceId} on port ${port}...`);
} else {
  require('./backend/server.js')
}
