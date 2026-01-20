const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Disable TLS certificate validation for self-signed certs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

require('dotenv').config({ quiet: true });

const app = express();
app.use(cors());
app.use(express.json());

// Environment configuration
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DATABASE_URL = process.env.DATABASE_URL;
const SERVERNAME = process.env.SERVERNAME || 'server1';
const PORT = process.env.PORT || 5000;

// Bot instances tracking
const botProcesses = {};
const instancePorts = {};
let portCounter = 4000;

// Database pool
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Initialize database
async function initDatabase() {
  try {
    const client = await pool.connect();
    
    // Server Manager Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS server_manager (
        id SERIAL PRIMARY KEY,
        server_name VARCHAR(50) UNIQUE NOT NULL,
        bot_count INTEGER DEFAULT 0,
        max_limit INTEGER DEFAULT 20,
        last_heartbeat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(20) DEFAULT 'active'
      )
    `);

    // Bot Instances Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS bot_instances (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        phone_number VARCHAR(50) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'new',
        server_name VARCHAR(50) NOT NULL,
        owner_id VARCHAR(100),
        port INTEGER,
        pid INTEGER,
        duration_months INTEGER,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        approved_at TIMESTAMP,
        expires_at TIMESTAMP,
        session_data JSONB
      )
    `);

    // Add session_data column if missing
    await client.query(`
      DO $$ 
      BEGIN 
        ALTER TABLE bot_instances ADD COLUMN IF NOT EXISTS session_data JSONB;
      EXCEPTION 
        WHEN duplicate_column THEN NULL;
      END $$;
    `);

    // Upsert current server
    await client.query(`
      INSERT INTO server_manager (server_name, last_heartbeat)
      VALUES ($1, NOW())
      ON CONFLICT (server_name) DO UPDATE 
      SET last_heartbeat = NOW()
    `, [SERVERNAME]);

    // Create indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_bot_instances_server_name ON bot_instances(server_name)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_bot_instances_status ON bot_instances(status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_bot_instances_phone ON bot_instances(phone_number)`);

    // Initialize port counter
    const result = await client.query('SELECT MAX(port) as max_port FROM bot_instances');
    if (result.rows[0].max_port) {
      portCounter = Math.max(portCounter, result.rows[0].max_port);
    }

    client.release();
    console.log(`✓ Database initialized successfully for ${SERVERNAME}`);
    console.log(`✓ Port counter initialized at ${portCounter}`);
  } catch (err) {
    console.error('✗ Database initialization failed:', err.message);
    throw err;
  }
}

function getNextPort() {
  portCounter += 1;
  return portCounter;
}

async function getInstanceStatus(instanceId, port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/status`, { 
      signal: AbortSignal.timeout(5000) 
    });
    if (response.ok) {
      return await response.json();
    }
  } catch (e) {}
  return { status: 'offline', pairingCode: null };
}

async function getPairingCodeFromInstance(port, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/pairing-code`, {
        signal: AbortSignal.timeout(5000)
      });
      if (response.ok) {
        const data = await response.json();
        if (data.pairingCode) {
          return data.pairingCode;
        }
        if (data.isAuthenticated) {
          return 'ALREADY_CONNECTED';
        }
      }
    } catch (e) {
      console.log(`Polling port ${port} attempt ${i + 1}/${maxAttempts}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  return null;
}

async function startInstanceInternal(instanceId, phoneNumber, port, sessionData = null) {
  const botDir = path.join(__dirname, '..', 'bot');
  
  try {
    if (botProcesses[instanceId]) {
      const proc = botProcesses[instanceId];
      if (!proc.killed) return true;
      delete botProcesses[instanceId];
    }

    // Write session data if provided
    if (sessionData) {
      const sessionDir = path.join(botDir, 'instances', instanceId, 'session');
      fs.mkdirSync(sessionDir, { recursive: true });
      const credsPath = path.join(sessionDir, 'creds.json');
      
      let credsToSave = sessionData;
      if (typeof sessionData === 'string') {
        credsToSave = JSON.parse(sessionData);
      }
      if (credsToSave.creds) {
        credsToSave = credsToSave.creds;
      }
      fs.writeFileSync(credsPath, JSON.stringify(credsToSave, null, 2));
      console.log(`💾 Restored session for ${instanceId}`);
    }

    const env = { ...process.env, BACKEND_URL: `http://127.0.0.1:${PORT}` };
    if (sessionData) env.HAS_SESSION = 'true';

    const proc = spawn('node', ['instance.js', instanceId, phoneNumber, String(port)], {
      cwd: botDir,
      detached: true,
      stdio: 'ignore',
      env
    });

    proc.unref();
    botProcesses[instanceId] = proc;
    instancePorts[instanceId] = port;

    await pool.query('UPDATE bot_instances SET pid = $1, updated_at = NOW() WHERE id = $2', [proc.pid, instanceId]);
    console.log(`✅ Started bot instance ${instanceId} on port ${port}`);

    await new Promise(r => setTimeout(r, 3000));
    if (proc.killed) {
      console.log(`❌ Bot instance ${instanceId} crashed immediately`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`❌ Failed to start bot instance ${instanceId}:`, e.message);
    return false;
  }
}

async function stopInstance(instanceId) {
  if (botProcesses[instanceId]) {
    try {
      botProcesses[instanceId].kill();
    } catch (e) {}
    delete botProcesses[instanceId];
    delete instancePorts[instanceId];
  }
  
  const result = await pool.query('SELECT pid FROM bot_instances WHERE id = $1', [instanceId]);
  if (result.rows[0]?.pid) {
    try {
      process.kill(result.rows[0].pid);
    } catch (e) {}
    await pool.query('UPDATE bot_instances SET pid = NULL WHERE id = $1', [instanceId]);
  }
}

async function findAvailableServer() {
  const result = await pool.query(`
    SELECT server_name FROM server_manager 
    WHERE status = 'active' 
    AND last_heartbeat > NOW() - INTERVAL '2 minutes'
    ORDER BY bot_count ASC 
    LIMIT 1
  `);
  return result.rows[0]?.server_name || SERVERNAME;
}

// Background tasks
async function checkExpiredBots() {
  try {
    const result = await pool.query(`
      UPDATE bot_instances
      SET status = 'expired', updated_at = NOW()
      WHERE status = 'approved' 
      AND expires_at <= NOW()
      AND server_name = $1
      RETURNING id
    `, [SERVERNAME]);

    for (const row of result.rows) {
      await stopInstance(row.id);
      console.log(`⏰ Bot ${row.id} expired and stopped`);
    }
  } catch (e) {
    console.error('Error in expiration check:', e.message);
  }
}

async function updateServerStatus() {
  try {
    const countResult = await pool.query(`
      SELECT COUNT(*) as count FROM bot_instances 
      WHERE server_name = $1 AND status = 'approved'
    `, [SERVERNAME]);
    
    const count = parseInt(countResult.rows[0].count);
    await pool.query(`
      UPDATE server_manager 
      SET bot_count = $1, last_heartbeat = NOW(), 
          status = CASE WHEN $1 >= max_limit THEN 'full' ELSE 'active' END
      WHERE server_name = $2
    `, [count, SERVERNAME]);
  } catch (e) {
    console.error('Error updating server status:', e.message);
  }
}

// ============ API Routes ============

app.get('/api/server-info', async (req, res) => {
  try {
    const total = await pool.query('SELECT COUNT(*) FROM bot_instances WHERE server_name = $1', [SERVERNAME]);
    const newBots = await pool.query("SELECT COUNT(*) FROM bot_instances WHERE server_name = $1 AND status = 'new'", [SERVERNAME]);
    const approved = await pool.query("SELECT COUNT(*) FROM bot_instances WHERE server_name = $1 AND status = 'approved'", [SERVERNAME]);
    const expired = await pool.query("SELECT COUNT(*) FROM bot_instances WHERE server_name = $1 AND status = 'expired'", [SERVERNAME]);
    
    res.json({
      server_name: SERVERNAME,
      total_bots: parseInt(total.rows[0].count),
      new_bots: parseInt(newBots.rows[0].count),
      approved_bots: parseInt(approved.rows[0].count),
      expired_bots: parseInt(expired.rows[0].count)
    });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    return res.json({ success: true, message: 'Login successful' });
  }
  res.status(401).json({ detail: 'Invalid credentials' });
});

// Get bot by phone number
app.get('/api/instances/by-phone/:phoneNumber', async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    const result = await pool.query(
      'SELECT * FROM bot_instances WHERE phone_number = $1 ORDER BY created_at DESC LIMIT 1',
      [phoneNumber]
    );
    
    if (result.rows.length === 0) {
      return res.json(null);
    }
    
    const instance = result.rows[0];
    res.json({
      id: instance.id,
      name: instance.name,
      phone_number: instance.phone_number,
      status: instance.status,
      server_name: instance.server_name,
      port: instance.port,
      created_at: instance.created_at?.toISOString(),
      expires_at: instance.expires_at?.toISOString()
    });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

// Pair existing bot (generates pairing code for existing bot)
app.post('/api/instances/:instanceId/pair', async (req, res) => {
  try {
    const { instanceId } = req.params;
    const { current_server } = req.body;
    
    const result = await pool.query('SELECT * FROM bot_instances WHERE id = $1', [instanceId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ detail: 'Instance not found' });
    }
    
    const instance = result.rows[0];
    const botServer = instance.server_name;
    let port = instance.port;
    
    // Assign port if not exists
    if (!port) {
      port = getNextPort();
      await pool.query('UPDATE bot_instances SET port = $1 WHERE id = $2', [port, instanceId]);
    }
    
    // Clear existing session for fresh pairing
    const botDir = path.join(__dirname, '..', 'bot');
    const sessionDir = path.join(botDir, 'instances', instanceId, 'session');
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    fs.mkdirSync(sessionDir, { recursive: true });
    
    // Clear session_data in DB for fresh pairing
    await pool.query('UPDATE bot_instances SET session_data = NULL WHERE id = $1', [instanceId]);
    
    // Start the instance locally (temporary if cross-server)
    await stopInstance(instanceId);
    const started = await startInstanceInternal(instanceId, instance.phone_number, port, null);
    
    if (!started) {
      return res.status(500).json({ detail: 'Failed to start instance for pairing' });
    }
    
    // Wait for instance to initialize
    await new Promise(r => setTimeout(r, 5000));
    
    // Get pairing code
    const pairingCode = await getPairingCodeFromInstance(port, 40);
    
    if (!pairingCode) {
      return res.status(500).json({ detail: 'Failed to generate pairing code - timeout' });
    }
    
    if (pairingCode === 'ALREADY_CONNECTED') {
      return res.json({ pairing_code: null, status: 'already_connected', message: 'Bot is already connected' });
    }
    
    res.json({ 
      pairing_code: pairingCode,
      instance_id: instanceId,
      server_name: botServer,
      is_cross_server: botServer !== current_server
    });
  } catch (e) {
    console.error('Pair error:', e);
    res.status(500).json({ detail: e.message });
  }
});

// Create new bot and get pairing code
app.post('/api/instances/pair-new', async (req, res) => {
  try {
    const { name, phone_number, current_server } = req.body;
    
    // Check if already exists
    const existing = await pool.query('SELECT id FROM bot_instances WHERE phone_number = $1', [phone_number]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ detail: 'Bot already exists for this phone number. Use pair endpoint instead.' });
    }
    
    // Find best server
    const targetServer = await findAvailableServer();
    const instanceId = uuidv4().substring(0, 8);
    const port = getNextPort();
    
    // Create in database
    await pool.query(
      'INSERT INTO bot_instances (id, name, phone_number, status, server_name, port) VALUES ($1, $2, $3, $4, $5, $6)',
      [instanceId, name, phone_number, 'new', targetServer, port]
    );
    
    // Setup directories
    const botDir = path.join(__dirname, '..', 'bot');
    const instanceDir = path.join(botDir, 'instances', instanceId);
    fs.mkdirSync(path.join(instanceDir, 'session'), { recursive: true });
    fs.mkdirSync(path.join(instanceDir, 'data'), { recursive: true });
    
    // Start instance
    const started = await startInstanceInternal(instanceId, phone_number, port, null);
    
    if (!started) {
      return res.status(500).json({ detail: 'Failed to start new instance' });
    }
    
    // Wait for initialization
    await new Promise(r => setTimeout(r, 5000));
    
    // Get pairing code
    const pairingCode = await getPairingCodeFromInstance(port, 40);
    
    if (!pairingCode) {
      return res.status(500).json({ detail: 'Failed to generate pairing code - timeout' });
    }
    
    res.json({
      id: instanceId,
      pairing_code: pairingCode,
      server_name: targetServer,
      port
    });
  } catch (e) {
    console.error('Pair-new error:', e);
    res.status(500).json({ detail: e.message });
  }
});

// Legacy create instance endpoint
app.post('/api/instances', async (req, res) => {
  try {
    const { name, phone_number, owner_id, auto_start = true } = req.body;
    
    const existing = await pool.query('SELECT id, server_name, port FROM bot_instances WHERE phone_number = $1', [phone_number]);
    
    let instanceId, targetServer, port;
    
    if (existing.rows.length > 0) {
      instanceId = existing.rows[0].id;
      targetServer = existing.rows[0].server_name;
      port = existing.rows[0].port || getNextPort();
      
      await stopInstance(instanceId);
      await pool.query(`
        UPDATE bot_instances 
        SET name = $1, owner_id = $2, port = $3, status = 'new', updated_at = NOW() 
        WHERE id = $4
      `, [name, owner_id, port, instanceId]);
    } else {
      targetServer = await findAvailableServer();
      instanceId = uuidv4().substring(0, 8);
      port = getNextPort();
      
      await pool.query(
        'INSERT INTO bot_instances (id, name, phone_number, status, server_name, owner_id, port) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [instanceId, name, phone_number, 'new', targetServer, owner_id, port]
      );
    }

    instancePorts[instanceId] = port;
    
    if (targetServer === SERVERNAME && auto_start) {
      setTimeout(() => startInstanceInternal(instanceId, phone_number, port), 1000);
    }

    res.json({
      id: instanceId,
      name,
      phone_number,
      status: 'new',
      server_name: targetServer,
      created_at: new Date().toISOString(),
      port
    });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

app.get('/api/instances/:instanceId/pairing-code', async (req, res) => {
  try {
    const { instanceId } = req.params;
    const result = await pool.query('SELECT * FROM bot_instances WHERE id = $1', [instanceId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ detail: 'Instance not found' });
    }

    const instance = result.rows[0];
    let port = instance.port;
    
    if (!port) {
      port = getNextPort();
      await pool.query('UPDATE bot_instances SET port = $1 WHERE id = $2', [port, instanceId]);
    }

    if (!botProcesses[instanceId]) {
      await startInstanceInternal(instanceId, instance.phone_number, port, instance.session_data);
      await new Promise(r => setTimeout(r, 8000));
    }

    try {
      const response = await fetch(`http://127.0.0.1:${port}/pairing-code`, {
        signal: AbortSignal.timeout(20000)
      });
      if (response.ok) {
        const data = await response.json();
        return res.json({ pairing_code: data.pairingCode, status: data.status });
      }
    } catch (e) {}

    const statusData = await getInstanceStatus(instanceId, port);
    res.json({ pairing_code: statusData.pairingCode, status: statusData.status });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

app.post('/api/instances/:instanceId/start', async (req, res) => {
  try {
    const { instanceId } = req.params;
    const result = await pool.query('SELECT * FROM bot_instances WHERE id = $1', [instanceId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ detail: 'Instance not found' });
    }

    const instance = result.rows[0];
    
    // Allow starting on any server for pairing purposes
    let port = instance.port;
    if (!port) {
      port = getNextPort();
      await pool.query('UPDATE bot_instances SET port = $1 WHERE id = $2', [port, instanceId]);
    }

    const success = await startInstanceInternal(instanceId, instance.phone_number, port, instance.session_data);
    if (success) {
      return res.json({ message: 'Instance started', port });
    }
    res.status(500).json({ detail: 'Failed to start instance' });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

app.post('/api/instances/:instanceId/stop', async (req, res) => {
  try {
    await stopInstance(req.params.instanceId);
    res.json({ message: 'Instance stopped' });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

app.delete('/api/instances/:instanceId', async (req, res) => {
  try {
    const { instanceId } = req.params;
    await stopInstance(instanceId);
    await pool.query('DELETE FROM bot_instances WHERE id = $1', [instanceId]);
    
    // Clean up files
    const botDir = path.join(__dirname, '..', 'bot');
    const instanceDir = path.join(botDir, 'instances', instanceId);
    if (fs.existsSync(instanceDir)) {
      fs.rmSync(instanceDir, { recursive: true, force: true });
    }
    
    res.json({ message: 'Instance deleted' });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

app.get('/api/instances', async (req, res) => {
  try {
    const { status, id, all_servers } = req.query;
    let result;
    
    const useAllServers = all_servers === 'true';
    
    if (id) {
      result = await pool.query('SELECT * FROM bot_instances WHERE id = $1', [id]);
    } else if (status && useAllServers) {
      result = await pool.query('SELECT * FROM bot_instances WHERE status = $1 ORDER BY created_at DESC', [status]);
    } else if (status) {
      result = await pool.query('SELECT * FROM bot_instances WHERE status = $1 AND server_name = $2 ORDER BY created_at DESC', [status, SERVERNAME]);
    } else if (useAllServers) {
      result = await pool.query('SELECT * FROM bot_instances ORDER BY created_at DESC');
    } else {
      result = await pool.query('SELECT * FROM bot_instances WHERE server_name = $1 ORDER BY created_at DESC', [SERVERNAME]);
    }

    const instances = [];
    for (const instance of result.rows) {
      let statusData = { status: instance.status, pairingCode: null, user: null };
      
      if (instance.status === 'approved' && instance.port && instance.server_name === SERVERNAME) {
        statusData = await getInstanceStatus(instance.id, instance.port);
      }

      instances.push({
        id: instance.id,
        name: instance.name,
        phone_number: instance.phone_number,
        status: statusData.status || instance.status,
        server_name: instance.server_name,
        owner_id: instance.owner_id,
        port: instance.port,
        pairing_code: statusData.pairingCode,
        connected_user: statusData.user,
        created_at: instance.created_at?.toISOString(),
        approved_at: instance.approved_at?.toISOString(),
        expires_at: instance.expires_at?.toISOString(),
        duration_months: instance.duration_months,
        session_data: instance.session_data
      });
    }

    res.json({ instances });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

app.post('/api/instances/:instanceId/approve', async (req, res) => {
  try {
    const { instanceId } = req.params;
    const { duration_months, current_server } = req.body;
    
    const result = await pool.query('SELECT * FROM bot_instances WHERE id = $1', [instanceId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ detail: 'Instance not found' });
    }

    const instance = result.rows[0];
    const botServer = instance.server_name;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30 * duration_months);

    await pool.query(`
      UPDATE bot_instances 
      SET status = 'approved', 
          duration_months = $1,
          approved_at = NOW(),
          expires_at = $2,
          updated_at = NOW()
      WHERE id = $3
    `, [duration_months, expiresAt, instanceId]);

    // Only start if on this server
    if (botServer === SERVERNAME) {
      await startInstanceInternal(instanceId, instance.phone_number, instance.port, instance.session_data);

      // Create approval flag
      const botDir = path.join(__dirname, '..', 'bot');
      const dataDir = path.join(botDir, 'instances', instanceId, 'data');
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(path.join(dataDir, 'approved.flag'), new Date().toISOString());
    }

    res.json({ 
      message: 'Instance approved',
      server_name: botServer,
      expires_at: expiresAt.toISOString()
    });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

app.post('/api/instances/:instanceId/renew', async (req, res) => {
  try {
    const { instanceId } = req.params;
    const { duration_months, current_server } = req.body;
    
    const result = await pool.query('SELECT * FROM bot_instances WHERE id = $1', [instanceId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ detail: 'Instance not found' });
    }

    const instance = result.rows[0];
    const botServer = instance.server_name;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30 * duration_months);

    await pool.query(`
      UPDATE bot_instances 
      SET status = 'approved', 
          duration_months = $1,
          expires_at = $2,
          updated_at = NOW()
      WHERE id = $3
    `, [duration_months, expiresAt, instanceId]);

    // Only start if on this server
    if (botServer === SERVERNAME) {
      await startInstanceInternal(instanceId, instance.phone_number, instance.port, instance.session_data);
    }

    res.json({ 
      message: 'Instance renewed',
      server_name: botServer,
      expires_at: expiresAt.toISOString()
    });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

app.post('/api/instances/:instanceId/sync-session', async (req, res) => {
  try {
    const { instanceId } = req.params;
    const { session_data } = req.body;
    
    await pool.query(`
      UPDATE bot_instances 
      SET session_data = $1, updated_at = NOW()
      WHERE id = $2
    `, [JSON.stringify(session_data), instanceId]);
    
    res.json({ message: 'Session synced' });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'static')));
app.use((req, res, next) => {
  const indexPath = path.join(__dirname, 'static', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Not found');
  }
});

// Start server
async function start() {
  console.log(`🚀 TREKKER MAX WABOT Backend Starting on ${SERVERNAME}...`);
  await initDatabase();

  // Start background tasks
  setInterval(checkExpiredBots, 60000);
  setInterval(updateServerStatus, 30000);

  // Restart approved instances
  const result = await pool.query(`
    SELECT * FROM bot_instances 
    WHERE server_name = $1 AND status = 'approved'
  `, [SERVERNAME]);

  const botDir = path.join(__dirname, '..', 'bot');
  for (const instance of result.rows) {
    const instancePath = path.join(botDir, 'instances', instance.id);
    fs.mkdirSync(path.join(instancePath, 'session'), { recursive: true });
    fs.mkdirSync(path.join(instancePath, 'data'), { recursive: true });
    fs.writeFileSync(path.join(instancePath, 'data', 'approved.flag'), new Date().toISOString());
    
    if (instance.port) {
      await startInstanceInternal(instance.id, instance.phone_number, instance.port, instance.session_data);
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✓ Server running on port ${PORT}`);
  });
}

start().catch(console.error);
