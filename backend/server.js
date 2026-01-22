const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const chalk = require('chalk');

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

// Database configuration
let dbPool;
let sqliteDb;
let useSQLite = false;

// Initialize Database Connection
if (DATABASE_URL) {
  dbPool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  console.log('Attempting to use PostgreSQL database...');
} else {
  useSQLite = true;
  const dbPath = path.join(__dirname, 'database.sqlite');
  sqliteDb = new sqlite3.Database(dbPath);
  console.log('No DATABASE_URL found, using SQLite fallback at:', dbPath);
}

// Database helper functions to unify PG and SQLite
const executeQuery = async (text, params = []) => {
  if (!useSQLite) {
    return await dbPool.query(text, params);
  }
  
  let sqliteText = text;
  params.forEach((_, i) => {
    sqliteText = sqliteText.replace(`$${i + 1}`, '?');
  });

  return new Promise((resolve, reject) => {
    if (sqliteText.trim().toUpperCase().startsWith('SELECT')) {
      sqliteDb.all(sqliteText, params, (err, rows) => {
        if (err) reject(err);
        else resolve({ rows });
      });
    } else {
      sqliteDb.run(sqliteText, params, function(err) {
        if (err) reject(err);
        else resolve({ rows: [], lastID: this.lastID, changes: this.changes });
      });
    }
  });
};

// Initialize database
async function initDatabase() {
  try {
    if (!useSQLite) {
      const client = await dbPool.connect();
      client.release();
    }

    const createTables = [
      `CREATE TABLE IF NOT EXISTS server_manager (
        id ${useSQLite ? 'INTEGER PRIMARY KEY' : 'SERIAL PRIMARY KEY'},
        server_name VARCHAR(50) UNIQUE NOT NULL,
        bot_count INTEGER DEFAULT 0,
        max_limit INTEGER DEFAULT 20,
        last_heartbeat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(20) DEFAULT 'active'
      )`,
      `CREATE TABLE IF NOT EXISTS bot_instances (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        phone_number VARCHAR(50) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'new',
        server_name VARCHAR(50) NOT NULL,
        owner_id VARCHAR(100),
        port INTEGER,
        pid INTEGER,
        duration_months INTEGER,
        created_at TIMESTAMP NOT NULL DEFAULT ${useSQLite ? 'CURRENT_TIMESTAMP' : 'NOW()'},
        updated_at TIMESTAMP NOT NULL DEFAULT ${useSQLite ? 'CURRENT_TIMESTAMP' : 'NOW()'},
        approved_at TIMESTAMP,
        expires_at TIMESTAMP,
        session_data ${useSQLite ? 'TEXT' : 'JSONB'}
      )`
    ];

    for (const sql of createTables) {
      await executeQuery(sql);
    }

    if (useSQLite) {
      await executeQuery(`
        INSERT OR REPLACE INTO server_manager (server_name, last_heartbeat)
        VALUES ($1, CURRENT_TIMESTAMP)
      `, [SERVERNAME]);
    } else {
      await executeQuery(`
        INSERT INTO server_manager (server_name, last_heartbeat)
        VALUES ($1, NOW())
        ON CONFLICT (server_name) DO UPDATE 
        SET last_heartbeat = NOW()
      `, [SERVERNAME]);
    }

    await executeQuery(`CREATE INDEX IF NOT EXISTS idx_bot_instances_server_name ON bot_instances(server_name)`);
    await executeQuery(`CREATE INDEX IF NOT EXISTS idx_bot_instances_status ON bot_instances(status)`);
    await executeQuery(`CREATE INDEX IF NOT EXISTS idx_bot_instances_phone ON bot_instances(phone_number)`);

    const result = await executeQuery('SELECT MAX(port) as max_port FROM bot_instances');
    if (result.rows[0]?.max_port) {
      portCounter = Math.max(portCounter, result.rows[0].max_port);
    }

    console.log(`✓ Database initialized successfully for ${SERVERNAME} (${useSQLite ? 'SQLite' : 'PostgreSQL'})`);
    console.log(`✓ Port counter initialized at ${portCounter}`);
  } catch (err) {
    if (!useSQLite && (err.code === 'ECONNREFUSED' || err.message.includes('connect'))) {
      console.warn('⚠️ PostgreSQL connection failed, falling back to SQLite...');
      useSQLite = true;
      const dbPath = path.join(__dirname, 'database.sqlite');
      sqliteDb = new sqlite3.Database(dbPath);
      return initDatabase();
    }
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

// Helper to identify and revive Buffers in JSON
function bufferReviver(key, value) {
  if (value && typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data)) {
    return Buffer.from(value.data);
  }
  return value;
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
        credsToSave = JSON.parse(sessionData, bufferReviver);
      }
      if (credsToSave.creds) {
        credsToSave = credsToSave.creds;
      }
      
      // Ensure it's saved as stringified JSON with Buffers handled by standard JSON.stringify 
      // which will keep the {type: 'Buffer', data: [...]} format that bot/instance.js can revive
      fs.writeFileSync(credsPath, JSON.stringify(credsToSave, null, 2));
      console.log(`💾 Restored session for ${instanceId}`);
    }

    const env = { ...process.env, BACKEND_URL: `http://127.0.0.1:${PORT}` };
    if (sessionData) env.HAS_SESSION = 'true';

    const proc = spawn('node', ['instance.js', instanceId, phoneNumber, String(port)], {
      cwd: botDir,
      detached: true,
      stdio: 'inherit',
      env
    });

    proc.unref();
    botProcesses[instanceId] = proc;
    instancePorts[instanceId] = port;

    const queryText = 'UPDATE bot_instances SET pid = $1, updated_at = ' + (useSQLite ? 'CURRENT_TIMESTAMP' : 'NOW()') + ' WHERE id = $2';
    await executeQuery(queryText, [proc.pid, instanceId]);
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
  
  const result = await executeQuery('SELECT pid FROM bot_instances WHERE id = $1', [instanceId]);
  if (result.rows[0]?.pid) {
    try {
      process.kill(result.rows[0].pid);
    } catch (e) {}
    await executeQuery('UPDATE bot_instances SET pid = NULL WHERE id = $1', [instanceId]);
  }
}

async function findAvailableServer() {
  const heartbeatQuery = useSQLite ? "DATETIME('now', '-2 minutes')" : "NOW() - INTERVAL '2 minutes'";
  const result = await executeQuery(`
    SELECT server_name FROM server_manager 
    WHERE status = 'active' 
    AND last_heartbeat > ${heartbeatQuery}
    ORDER BY bot_count ASC 
    LIMIT 1
  `);
  return result.rows[0]?.server_name || SERVERNAME;
}

// Background tasks
async function checkExpiredBots() {
  try {
    const nowFunc = useSQLite ? 'CURRENT_TIMESTAMP' : 'NOW()';
    const result = await executeQuery(`
      UPDATE bot_instances
      SET status = 'expired', updated_at = ${nowFunc}
      WHERE status = 'approved' 
      AND expires_at <= ${nowFunc}
      AND server_name = $1
      RETURNING id
    `, [SERVERNAME]);

    if (result.rows) {
      for (const row of result.rows) {
        await stopInstance(row.id);
        console.log(`⏰ Bot ${row.id} expired and stopped`);
      }
    }
  } catch (e) {
    console.error('Error in expiration check:', e.message);
  }
}

async function updateServerStatus() {
  try {
    const countResult = await executeQuery(`
      SELECT COUNT(*) as count FROM bot_instances 
      WHERE server_name = $1 AND status = 'approved'
    `, [SERVERNAME]);
    
    const count = parseInt(countResult.rows[0].count);
    const nowFunc = useSQLite ? 'CURRENT_TIMESTAMP' : 'NOW()';
    await executeQuery(`
      UPDATE server_manager 
      SET bot_count = $1, last_heartbeat = ${nowFunc}, 
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
    const total = await executeQuery('SELECT COUNT(*) as count FROM bot_instances WHERE server_name = $1', [SERVERNAME]);
    const newBots = await executeQuery("SELECT COUNT(*) as count FROM bot_instances WHERE server_name = $1 AND status = 'new'", [SERVERNAME]);
    const approved = await executeQuery("SELECT COUNT(*) as count FROM bot_instances WHERE server_name = $1 AND status = 'approved'", [SERVERNAME]);
    const expired = await executeQuery("SELECT COUNT(*) as count FROM bot_instances WHERE server_name = $1 AND status = 'expired'", [SERVERNAME]);
    
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
    const result = await executeQuery(
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
      created_at: instance.created_at,
      expires_at: instance.expires_at
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
    
    const result = await executeQuery('SELECT * FROM bot_instances WHERE id = $1', [instanceId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ detail: 'Instance not found' });
    }
    
    const instance = result.rows[0];
    const botServer = instance.server_name;
    let port = instance.port;
    
    // Assign port if not exists
    if (!port) {
      port = getNextPort();
      await executeQuery('UPDATE bot_instances SET port = $1 WHERE id = $2', [port, instanceId]);
    }
    
    // Clear existing session for fresh pairing
    const botDir = path.join(__dirname, '..', 'bot');
    const sessionDir = path.join(botDir, 'instances', instanceId, 'session');
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    fs.mkdirSync(sessionDir, { recursive: true });
    
    // Clear session_data in DB for fresh pairing
    await executeQuery('UPDATE bot_instances SET session_data = NULL WHERE id = $1', [instanceId]);
    
    // Start the instance locally (temporary if cross-server)
    await stopInstance(instanceId);
    const started = await startInstanceInternal(instanceId, instance.phone_number, port, null);
    
    if (!started) {
      return res.status(500).json({ detail: 'Failed to start instance for pairing' });
    }
    
    // Wait for instance to initialize
    await new Promise(r => setTimeout(r, 5000));
    
    // Force trigger pairing code generation by calling /pairing-code on the instance
    try {
        await fetch(`http://127.0.0.1:${port}/pairing-code`);
    } catch (e) {
        console.error('Error triggering pairing code:', e.message);
    }
    
    // Get pairing code
    const pairingCode = await getPairingCodeFromInstance(port, 40);
    
    if (!pairingCode) {
      console.log(chalk.red(`❌ [PAIRING] Failed to generate pairing code for ${instanceId} after 40 attempts`));
      return res.status(500).json({ detail: 'Failed to generate pairing code - timeout' });
    }
    
    if (pairingCode === 'ALREADY_CONNECTED') {
      console.log(chalk.green(`✅ [PAIRING] Bot ${instanceId} is already connected`));
      return res.json({ pairing_code: null, status: 'already_connected', message: 'Bot is already connected' });
    }
    
    console.log(chalk.green(`🔑 [PAIRING] Generated code for ${instanceId}: ${pairingCode}`));
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
    const existing = await executeQuery('SELECT id FROM bot_instances WHERE phone_number = $1', [phone_number]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ detail: 'Bot already exists for this phone number. Use pair endpoint instead.' });
    }
    
    // Find best server
    const targetServer = await findAvailableServer();
    const instanceId = uuidv4().substring(0, 8);
    const port = getNextPort();
    
    // Create in database
    await executeQuery(
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
      console.log(chalk.red(`❌ [PAIRING-NEW] Failed to generate pairing code for ${instanceId} after 40 attempts`));
      return res.status(500).json({ detail: 'Failed to generate pairing code - timeout' });
    }
    
    console.log(chalk.green(`🔑 [PAIRING-NEW] Generated code for ${instanceId}: ${pairingCode}`));
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
    
    const existing = await executeQuery('SELECT id, server_name, port FROM bot_instances WHERE phone_number = $1', [phone_number]);
    
    let instanceId, targetServer, port;
    
    if (existing.rows.length > 0) {
      instanceId = existing.rows[0].id;
      targetServer = existing.rows[0].server_name;
      port = existing.rows[0].port || getNextPort();
      
      await stopInstance(instanceId);
      const updateNow = useSQLite ? 'CURRENT_TIMESTAMP' : 'NOW()';
      await executeQuery(`
        UPDATE bot_instances 
        SET name = $1, owner_id = $2, port = $3, status = 'new', updated_at = ${updateNow} 
        WHERE id = $4
      `, [name, owner_id, port, instanceId]);
    } else {
      targetServer = await findAvailableServer();
      instanceId = uuidv4().substring(0, 8);
      port = getNextPort();
      
      await executeQuery(
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

app.post('/api/instances/:instanceId/regenerate-code', async (req, res) => {
  try {
    const { instanceId } = req.params;
    const result = await executeQuery('SELECT port FROM bot_instances WHERE id = $1', [instanceId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ detail: 'Instance not found' });
    }

    const port = result.rows[0].port;
    if (!port) {
       return res.status(400).json({ detail: 'Instance has no assigned port' });
    }

    const response = await fetch(`http://127.0.0.1:${port}/regenerate-code`, {
      method: 'POST',
      signal: AbortSignal.timeout(10000)
    });

    if (response.ok) {
      return res.json(await response.json());
    }
    res.status(500).json({ detail: 'Failed to trigger regeneration on instance' });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

app.get('/api/instances/:instanceId/pairing-code', async (req, res) => {
  try {
    const { instanceId } = req.params;
    const result = await executeQuery('SELECT * FROM bot_instances WHERE id = $1', [instanceId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ detail: 'Instance not found' });
    }

    const instance = result.rows[0];
    let port = instance.port;
    
    if (!port) {
      port = getNextPort();
      await executeQuery('UPDATE bot_instances SET port = $1 WHERE id = $2', [port, instanceId]);
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

// Sync session data from bot instance
app.post('/api/instances/:instanceId/sync-session', async (req, res) => {
  try {
    const { instanceId } = req.params;
    const { session_data, status, last_error } = req.body;
    
    const updateNow = useSQLite ? 'CURRENT_TIMESTAMP' : 'NOW()';
    let query = 'UPDATE bot_instances SET updated_at = ' + updateNow;
    const params = [];
    let paramIdx = 1;

    if (session_data) {
      query += `, session_data = $${paramIdx++}`;
      params.push(session_data);
    }

    if (status) {
      query += `, status = $${paramIdx++}`;
      params.push(status);
    }

    query += ` WHERE id = $${paramIdx}`;
    params.push(instanceId);

    if (params.length > 1) {
      await executeQuery(query, params);
    }

    res.json({ success: true });
  } catch (e) {
    console.error(`[SYNC ERROR] Failed to sync session for ${instanceId}:`, e.message);
    res.status(500).json({ detail: e.message });
  }
});

app.post('/api/instances/:instanceId/start', async (req, res) => {
  try {
    const { instanceId } = req.params;
    const result = await executeQuery('SELECT * FROM bot_instances WHERE id = $1', [instanceId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ detail: 'Instance not found' });
    }

    const instance = result.rows[0];
    
    // Allow starting on any server for pairing purposes
    let port = instance.port;
    if (!port) {
      port = getNextPort();
      await executeQuery('UPDATE bot_instances SET port = $1 WHERE id = $2', [port, instanceId]);
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
    await executeQuery('DELETE FROM bot_instances WHERE id = $1', [instanceId]);
    
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
      result = await executeQuery('SELECT * FROM bot_instances WHERE id = $1', [id]);
    } else if (status && useAllServers) {
      result = await executeQuery('SELECT * FROM bot_instances WHERE status = $1 ORDER BY created_at DESC', [status]);
    } else if (status) {
      result = await executeQuery('SELECT * FROM bot_instances WHERE status = $1 AND server_name = $2 ORDER BY created_at DESC', [status, SERVERNAME]);
    } else if (useAllServers) {
      result = await executeQuery('SELECT * FROM bot_instances ORDER BY created_at DESC');
    } else {
      result = await executeQuery('SELECT * FROM bot_instances WHERE server_name = $1 ORDER BY created_at DESC', [SERVERNAME]);
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
        created_at: instance.created_at,
        approved_at: instance.approved_at,
        expires_at: instance.expires_at,
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
    const { duration_months } = req.body;
    
    const result = await executeQuery('SELECT * FROM bot_instances WHERE id = $1', [instanceId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ detail: 'Instance not found' });
    }

    const instance = result.rows[0];
    const botServer = instance.server_name;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30 * duration_months);

    const nowFunc = useSQLite ? 'CURRENT_TIMESTAMP' : 'NOW()';
    await executeQuery(`
      UPDATE bot_instances 
      SET status = 'approved', 
          duration_months = $1,
          approved_at = ${nowFunc},
          expires_at = $2,
          updated_at = ${nowFunc}
      WHERE id = $3
    `, [duration_months, expiresAt.toISOString(), instanceId]);

    // Only start if on this server
    if (botServer === SERVERNAME) {
      await startInstanceInternal(instanceId, instance.phone_number, instance.port, instance.session_data);
    }

    res.json({ message: 'Instance approved and started', expires_at: expiresAt });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

// Server static files from the React app
app.use(express.static(path.join(__dirname, 'static')));

// The "catchall" handler: for any request that doesn't
// match one above, send back React's index.html file.
app.get(/^(?!\/api).*/, (req, res) => {
    const indexPath = path.join(__dirname, 'static', 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send('Frontend not found. Please run build script.');
    }
});

// Start initialization and server
async function startServer() {
  try {
    await initDatabase();
    
    // Initial cleanup/update
    await checkExpiredBots();
    await updateServerStatus();
    
    // Start approved bots on this server
    const result = await executeQuery("SELECT * FROM bot_instances WHERE status = 'approved' AND server_name = $1", [SERVERNAME]);
    console.log(`🚀 Starting ${result.rows.length} approved bots...`);
    for (const bot of result.rows) {
      startInstanceInternal(bot.id, bot.phone_number, bot.port, bot.session_data);
    }

    // Intervals
    setInterval(checkExpiredBots, 10 * 60 * 1000); // 10 mins
    setInterval(updateServerStatus, 60 * 1000); // 1 min

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`
=========================================
🛡️  KnightBot Backend Running
📍  Port: ${PORT}
👤  Admin: ${ADMIN_USERNAME}
📦  Database: ${useSQLite ? 'SQLite' : 'PostgreSQL'}
🌍  Server Name: ${SERVERNAME}
=========================================
      `);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
