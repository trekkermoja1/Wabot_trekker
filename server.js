const instanceId = process.argv[2];

if (instanceId) {
  const { spawn } = require('child_process');
  const path = require('path');
  
  const botDir = path.join(__dirname, 'bot');
  const port = process.env.INSTANCE_PORT || process.argv[3] || '4000';
  const phoneNumber = process.argv[4] || '';
  
  const proc = spawn('node', ['instance.js', instanceId, phoneNumber, port], {
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
