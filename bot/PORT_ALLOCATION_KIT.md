# Port Allocation Kit

This document describes how ports are allocated for bot instances in this project.

## Overview
The backend server (`backend/server.js`) manages port allocation for individual bot instances. It ensures that each instance runs on a unique port to avoid conflicts.

## Allocation Logic
1. **Starting Port**: The system starts with a base port counter (e.g., `4000`).
2. **Initialization**: On startup, the server queries the database for the maximum port currently assigned to any instance.
3. **Incrementing**: When a new instance is created or an existing one needs a port, the `getNextPort()` function is called.
4. **Consistency**: The assigned port is stored in the `bot_instances` database table and used to spawn the bot process.

## Key Code Snippets

### Port Counter Initialization
```javascript
let portCounter = 4000;
// ... later in initDatabase()
const result = await executeQuery('SELECT MAX(port) as max_port FROM bot_instances');
if (result.rows[0]?.max_port) {
  portCounter = Math.max(portCounter, result.rows[0].max_port);
}
```

### Port Assignment Function
```javascript
function getNextPort() {
  portCounter += 1;
  return portCounter;
}
```

### Usage in API
```javascript
app.post('/api/instances/pair-new', async (req, res) => {
  // ...
  const port = getNextPort();
  // ...
  await executeQuery(
    'INSERT INTO bot_instances (..., port) VALUES (..., $7)',
    [..., port]
  );
  // ...
});
```

## Manual Override
If a manual port allocation is needed, ensure it is outside the range managed by the `portCounter` or update the database record and restart the server to sync the counter.
