const os = require('os');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const chalk = require('chalk');

require('dotenv').config({ quiet: true });

// Swagger setup
const swaggerUi = require('swagger-ui-express');
const swaggerJsDoc = require('swagger-jsdoc');

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Trekker WABOT API',
      version: '1.0.0',
      description: 'WhatsApp Bot Management API - Pairing & Management',
    },
    servers: [
      { url: '/' }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [],
  },
  apis: [],
};

const swaggerDocs = swaggerJsDoc(swaggerOptions);

let globalPairProcess = null;

async function startGlobalPairServer() {
  const net = require('net');
  
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    client.setTimeout(2000);
    client.connect(9000, '127.0.0.1', () => {
      client.destroy();
      console.log(chalk.blue('ℹ️ Globalpair server already running'));
      resolve(true);
    });
    client.on('error', (err) => {
      client.destroy();
      if (err.code !== 'ECONNREFUSED') {
        console.log(chalk.blue('ℹ️ Globalpair server error, but continuing: ' + err.message));
        resolve(true);
        return;
      }
      
      const botDir = path.join(__dirname, '..', 'bot');
      const env = { ...process.env, PORT: '9000' };
      globalPairProcess = spawn('node', ['pairingserver.js'], {
        cwd: botDir,
        detached: true,
        stdio: 'inherit',
        env
      });
      globalPairProcess.unref();
      
      console.log(chalk.blue('🔄 Started globalpair server on port 9000'));
      
      let attempts = 0;
      const checkReady = () => {
        attempts++;
        const checkClient = new net.Socket();
        checkClient.setTimeout(2000);
        checkClient.connect(9000, '127.0.0.1', () => {
          checkClient.destroy();
          console.log(chalk.green('✅ Globalpair server ready'));
          resolve(true);
        });
        checkClient.on('error', (err) => {
          checkClient.destroy();
          if (attempts >= 10) {
            reject(new Error('Failed to start globalpair server: ' + err.message));
          } else {
            setTimeout(checkReady, 1000);
          }
        });
        checkClient.on('timeout', () => {
          checkClient.destroy();
          if (attempts >= 10) {
            reject(new Error('Failed to start globalpair server: timeout'));
          } else {
            setTimeout(checkReady, 1000);
          }
        });
      };
      setTimeout(checkReady, 2000);
    });
    client.on('timeout', () => {
      client.destroy();
      console.log(chalk.blue('ℹ️ Globalpair server check timeout'));
      resolve(true);
    });
  });
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Swagger UI at /api-docs
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs, {
  customCss: `
    .swagger-ui .topbar { display: none }
    .swagger-ui .info .title { font-size: 2.5em; }
    .swagger-ui .info .description { font-size: 1.1em; line-height: 1.6; }
  `,
  customSiteTitle: 'Trekker WABOT API Docs',
  customfavIcon: '/favicon.ico'
}));

// Environment configuration
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DATABASE_URL = process.env.DATABASE_URL;
const SERVERNAME = (process.env.SERVER_NAME || process.env.SERVERNAME || 'server1').toLowerCase();
const PORT = process.env.PORT || 5000;
const WEB_ENABLED = process.env.WEB === 'true';

// Dynamic URL detection
app.use((req, res, next) => {
  if (!process.env.BACKEND_URL) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers.host;
    process.env.BACKEND_URL = `${protocol}://${host}`;
  }
  next();
});

// Restart instance
app.post('/api/instances/:instanceId/restart', async (req, res) => {
  try {
    const { instanceId } = req.params;
    const result = await executeQuery('SELECT * FROM bot_instances WHERE id = $1', [instanceId]);
    if (result.rows.length === 0) return res.status(404).json({ detail: 'Instance not found' });
    const instance = result.rows[0];
    await stopInstance(instanceId);
    await startInstanceInternal(instanceId, instance.phone_number, instance.port, instance.session_data);
    res.json({ success: true, message: 'Restart command sent' });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

// Update autoview setting
app.post('/api/instances/:instanceId/autoview', async (req, res) => {
  try {
    const { instanceId } = req.params;
    const { enabled } = req.body;
    await executeQuery('UPDATE bot_instances SET autoview = $1 WHERE id = $2', [enabled, instanceId]);
    res.json({ success: true, message: 'Autoview updated' });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

/**
 * @swagger
 * /api/instances/search:
 *   get:
 *     summary: Search bots by phone number, ID, or name
 *     parameters:
 *       - in: query
 *         name: query
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Search results
 */
app.get('/api/instances/search', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query || query.length < 2) {
      return res.json({ instances: [] });
    }
    
    const searchPattern = `%${query}%`;
    const result = await executeQuery(
      'SELECT * FROM bot_instances WHERE id LIKE $1 OR phone_number LIKE $1 OR name LIKE $1 ORDER BY created_at DESC LIMIT 20',
      [searchPattern]
    );
    
    const instances = [];
    for (const instance of result.rows) {
      let statusData = { status: instance.status, pairingCode: null, user: null };
      
      if (instance.start_status === 'approved' && instance.port && instance.server_name === SERVERNAME) {
        statusData = await getInstanceStatus(instance.id, instance.port);
      }
      
      instances.push({
        id: instance.id,
        name: instance.name,
        phone_number: instance.phone_number,
        status: statusData.status || instance.status,
        start_status: instance.start_status,
        server_name: instance.server_name,
        owner_id: instance.owner_id,
        port: instance.port,
        created_at: instance.created_at,
        approved_at: instance.approved_at,
        expires_at: instance.expires_at,
        duration_months: instance.duration_months,
        autoview: instance.autoview
      });
    }
    
    res.json({ instances });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

// Update bot name
app.put('/api/instances/:instanceId/name', async (req, res) => {
  try {
    const { instanceId } = req.params;
    const { name } = req.body;
    
    if (!name || name.trim() === '') {
      return res.status(400).json({ detail: 'Name is required' });
    }
    
    const result = await executeQuery('UPDATE bot_instances SET name = $1 WHERE id = $2 RETURNING *', [name.trim(), instanceId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ detail: 'Instance not found' });
    }
    
    res.json({ success: true, message: 'Bot name updated', bot: result.rows[0] });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

/**
 * @swagger
 * /api/instances/all:
 *   get:
 *     summary: Get all bots across all servers
 *     responses:
 *       200:
 *         description: List of all bots
 */
app.get('/api/instances/all', async (req, res) => {
  try {
    const result = await executeQuery('SELECT * FROM bot_instances ORDER BY created_at DESC');
    
    const instances = result.rows.map(instance => ({
      id: instance.id,
      name: instance.name,
      phone_number: instance.phone_number,
      status: instance.status,
      start_status: instance.start_status,
      server_name: instance.server_name,
      owner_id: instance.owner_id,
      port: instance.port,
      created_at: instance.created_at,
      approved_at: instance.approved_at,
      expires_at: instance.expires_at,
      duration_months: instance.duration_months,
      autoview: instance.autoview
    }));
    
    res.json({ instances });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

/**
 * @swagger
 * /api/instances/server-bots:
 *   get:
 *     summary: Get bots on this server only
 *     responses:
 *       200:
 *         description: List of bots on current server
 */
app.get('/api/instances/server-bots', async (req, res) => {
  try {
    const result = await executeQuery(
      'SELECT * FROM bot_instances WHERE server_name = $1 ORDER BY created_at DESC',
      [SERVERNAME]
    );
    
    const instances = [];
    for (const instance of result.rows) {
      let statusData = { status: instance.status, pairingCode: null, user: null };
      
      if (instance.port) {
        statusData = await getInstanceStatus(instance.id, instance.port);
      }
      
      instances.push({
        id: instance.id,
        name: instance.name,
        phone_number: instance.phone_number,
        status: statusData.status || instance.status,
        start_status: instance.start_status,
        server_name: instance.server_name,
        owner_id: instance.owner_id,
        port: instance.port,
        pid: instance.pid,
        created_at: instance.created_at,
        approved_at: instance.approved_at,
        expires_at: instance.expires_at,
        duration_months: instance.duration_months,
        autoview: instance.autoview
      });
    }
    
    res.json({ instances });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

// Restart bot
app.post('/api/instances/:instanceId/restart', async (req, res) => {
  try {
    const { instanceId } = req.params;
    const result = await executeQuery('SELECT * FROM bot_instances WHERE id = $1', [instanceId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ detail: 'Instance not found' });
    }
    
    const instance = result.rows[0];
    
    if (instance.server_name !== SERVERNAME) {
      return res.status(400).json({ detail: 'Bot is not on this server' });
    }
    
    await stopInstance(instanceId);
    await startInstanceInternal(instanceId, instance.phone_number, instance.port, instance.session_data);
    
    res.json({ success: true, message: 'Bot restarted' });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

// Toggle bot enabled status
app.post('/api/instances/:instanceId/enable', async (req, res) => {
  try {
    const { instanceId } = req.params;
    const { enabled } = req.body;
    
    const result = await executeQuery('UPDATE bot_instances SET status = $1 WHERE id = $2 RETURNING *', 
      [enabled ? 'enabled' : 'disabled', instanceId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ detail: 'Instance not found' });
    }
    
    res.json({ success: true, message: enabled ? 'Bot enabled' : 'Bot disabled', bot: result.rows[0] });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

// Delete bot from database (for any server)
app.delete('/api/instances/:instanceId/db', async (req, res) => {
  try {
    const { instanceId } = req.params;
    
    // Get bot info first
    const result = await executeQuery('SELECT * FROM bot_instances WHERE id = $1', [instanceId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ detail: 'Instance not found' });
    }
    
    const instance = result.rows[0];
    
    // Stop if on this server
    if (instance.server_name === SERVERNAME) {
      await stopInstance(instanceId);
    }
    
    // Delete from database
    await executeQuery('DELETE FROM bot_instances WHERE id = $1', [instanceId]);
    
    // Clean up files if on this server
    if (instance.server_name === SERVERNAME) {
      const botDir = path.join(__dirname, '..', 'bot');
      const instanceDir = path.join(botDir, 'instances', instanceId);
      if (fs.existsSync(instanceDir)) {
        fs.rmSync(instanceDir, { recursive: true, force: true });
      }
    }
    
    res.json({ success: true, message: 'Bot deleted from database', deleted_bot: instance });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

// Update bot server name in database
app.put('/api/instances/:instanceId/server', async (req, res) => {
  try {
    const { instanceId } = req.params;
    const { server_name } = req.body;
    
    // Get available servers
    const serversResult = await executeQuery('SELECT * FROM server_manager WHERE status = $1', ['active']);
    
    if (!server_name) {
      return res.json({ 
        available_servers: serversResult.rows,
        current_server: SERVERNAME 
      });
    }
    
    // Check if server exists
    const serverExists = serversResult.rows.find(s => s.server_name === server_name);
    if (!serverExists) {
      return res.status(400).json({ detail: 'Server not available' });
    }
    
    const result = await executeQuery('UPDATE bot_instances SET server_name = $1 WHERE id = $2 RETURNING *', 
      [server_name, instanceId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ detail: 'Instance not found' });
    }
    
    res.json({ success: true, message: `Bot moved to ${server_name}`, bot: result.rows[0] });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

// Serve static files - only when WEB is enabled
if (WEB_ENABLED) {
  app.use(express.static(path.join(__dirname, 'static')));
}

// Always serve public directory (simple pairing page)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Main landing page - always serve public/index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Dashboard route - only when WEB is enabled
if (WEB_ENABLED) {
  app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'index.html'));
  });
}

// Clean up bot instances on startup - disabled to prevent EADDRINUSE and data loss on server restart
/*
const botInstancesDir = path.join(__dirname, '..', 'bot', 'instances');
if (fs.existsSync(botInstancesDir)) {
  try {
    fs.rmSync(botInstancesDir, { recursive: true, force: true });
    console.log('🧹 Cleaned bot instances directory on startup');
  } catch (err) {
    console.error('⚠️ Failed to clean bot instances directory:', err.message);
  }
}
fs.mkdirSync(botInstancesDir, { recursive: true });
*/
const botInstancesDir = path.join(__dirname, '..', 'bot', 'instances');
if (!fs.existsSync(botInstancesDir)) {
    fs.mkdirSync(botInstancesDir, { recursive: true });
}

// const os = require('os'); (duplicated)

// Bot instances tracking
const botProcesses = {};
const instancePorts = {};
let portCounter = 4000;

// Resource monitoring and auto-scaling (disabled)
// const RESOURCE_CHECK_INTERVAL = 30000; // 30 seconds
// const MAX_CPU_USAGE = 95; // %
// const MAX_MEM_USAGE = 95; // %

// async function monitorResources() {
//   try {
//     const cpus = os.cpus();
//     const load = os.loadavg()[0]; // 1-minute load average
//     const cpuUsage = (load / cpus.length) * 100;
//     
//     const totalMem = os.totalmem();
//     const freeMem = os.freemem();
//     const memUsage = ((totalMem - freeMem) / totalMem) * 100;
//
//     if (cpuUsage > MAX_CPU_USAGE || memUsage > MAX_MEM_USAGE) {
//       const activeBots = Object.keys(botProcesses);
//       if (activeBots.length > 0) {
//         // Stop the most recently started bot to reduce load
//         const botToStop = activeBots[activeBots.length - 1];
//         await stopInstance(botToStop);
//       }
//     }
//   } catch (err) {
//     console.error('Error in resource monitor:', err.message);
//   }
// }

// setInterval(monitorResources, RESOURCE_CHECK_INTERVAL);

// Database configuration
let dbPool;
let sqliteDb;
let useSQLite = false;

// Initialize Database Connection
if (DATABASE_URL) {
  dbPool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { sslrootcert: 'system' }
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
        start_status VARCHAR(20) NOT NULL DEFAULT 'new',
        server_name VARCHAR(50) NOT NULL,
        owner_id VARCHAR(100),
        port INTEGER,
        pid INTEGER,
        duration_months INTEGER,
        autoview BOOLEAN DEFAULT false,
        chatbot_enabled BOOLEAN DEFAULT false,
        chatbot_api_key VARCHAR(500),
        chatbot_base_url VARCHAR(500),
        sec_db_pass VARCHAR(500),
        created_at TIMESTAMP NOT NULL DEFAULT ${useSQLite ? 'CURRENT_TIMESTAMP' : 'NOW()'},
        updated_at TIMESTAMP NOT NULL DEFAULT ${useSQLite ? 'CURRENT_TIMESTAMP' : 'NOW()'},
        approved_at TIMESTAMP,
        expires_at TIMESTAMP,
        session_data ${useSQLite ? 'TEXT' : 'JSONB'}
      )`,
      `CREATE TABLE IF NOT EXISTS global_chatbot_config (
        id INTEGER PRIMARY KEY,
        chatbot_api_key VARCHAR(500),
        chatbot_base_url VARCHAR(500),
        sec_db_host VARCHAR(200),
        sec_db_port INTEGER DEFAULT 5432,
        sec_db_name VARCHAR(100) DEFAULT 'crate',
        sec_db_user VARCHAR(100) DEFAULT 'admin',
        sec_db_pass VARCHAR(500),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
  const hosts = ['0.0.0.0', '127.0.0.1', 'localhost'];
  for (const host of hosts) {
    try {
      const response = await axios.get(`http://${host}:${port}/status`, { 
        timeout: 5000 
      });
      return response.data;
    } catch (e) {
      // Continue to next host
    }
  }
  return { status: 'offline', pairingCode: null };
}

async function getPairingCodeFromInstance(port, maxAttempts = 30) {
  const hosts = ['0.0.0.0', '127.0.0.1', 'localhost'];
  for (let i = 0; i < maxAttempts; i++) {
    for (const host of hosts) {
      try {
        const response = await axios.get(`http://${host}:${port}/pairing-code`, {
          timeout: 5000
        });
        const data = response.data;
        if (data.pairingCode) return data.pairingCode;
        if (data.isAuthenticated) return 'ALREADY_CONNECTED';
        break; // If we got a response but no code, wait for next attempt
      } catch (e) {
        // Try next host
      }
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

async function startInstanceInternal(instanceId, phoneNumber, port, sessionData = null, isDevMode = false) {
  const botDir = path.join(__dirname, '..', 'bot');
  
  try {
    // Check if bot status is offline - skip if so
    const statusResult = await executeQuery('SELECT status FROM bot_instances WHERE id = $1', [instanceId]);
    if (statusResult.rows[0]?.status === 'offline') {
      console.log(chalk.yellow(`⏭️ Bot ${instanceId} is offline, skipping start`));
      return false;
    }

    if (botProcesses[instanceId]) {
      const proc = botProcesses[instanceId];
      if (!proc.killed) return true;
      delete botProcesses[instanceId];
    }

    // Check if session files already exist locally first
    const sessionDir = path.join(botDir, 'instances', instanceId, 'session');
    const localSessionExists = fs.existsSync(sessionDir) && fs.readdirSync(sessionDir).length > 0;
    
    // Only use sessionData from DB if no local session exists
    if (!localSessionExists && sessionData) {
      if (!fs.existsSync(sessionDir)) {
          fs.mkdirSync(sessionDir, { recursive: true });
      }
      const credsPath = path.join(sessionDir, 'creds.json');
      
      let credsToSave = sessionData;
      if (typeof sessionData === 'string') {
        credsToSave = JSON.parse(sessionData, bufferReviver);
      }
      if (credsToSave.creds) {
        credsToSave = credsToSave.creds;
      }
      
      fs.writeFileSync(credsPath, JSON.stringify(credsToSave, null, 2));
      console.log(`💾 Restored session for ${instanceId} from DB`);
    } else if (localSessionExists) {
      console.log(`💾 Session files found locally for ${instanceId}`);
    }

    const publicDomain = process.env.BACKEND_URL || `http://0.0.0.0:${PORT}`;
    const env = { ...process.env, BACKEND_URL: publicDomain };
    if (isDevMode) env.DEV_MODE = 'true';
    
    // Pass session data as an argument if it exists
    let autoview = true;
    try {
      const result = await executeQuery('SELECT autoview FROM bot_instances WHERE id = $1', [instanceId]);
      if (result.rows.length > 0 && result.rows[0].autoview !== null) {
        autoview = result.rows[0].autoview;
      }
    } catch (e) {
      console.error('Error fetching autoview for startup:', e.message);
    }

    const script = (autoview === true) ? 'instance.js' : 'instance_nostatus.js';
    const instanceArgs = [script, instanceId, phoneNumber, String(port)];
    if (sessionData) {
      env.HAS_SESSION = 'true';
      let sessionDataStr;
      if (typeof sessionData === 'string') {
        sessionDataStr = sessionData;
      } else {
        sessionDataStr = JSON.stringify(sessionData);
      }
      instanceArgs.push(sessionDataStr);
    }

    const proc = spawn('node', instanceArgs, {
      cwd: botDir,
      detached: true,
      stdio: 'inherit',
      env
    });

    proc.unref();
    botProcesses[instanceId] = proc;
    instancePorts[instanceId] = port;

    proc.on('exit', (code, signal) => {
      console.log(chalk.yellow(`[RESTART] Bot ${instanceId} exited with code ${code}, restarting...`));
      delete botProcesses[instanceId];
      delete instancePorts[instanceId];
      
      if (code !== 0) {
        setTimeout(async () => {
          try {
            await startInstanceInternal(instanceId, phoneNumber, port, sessionData);
            console.log(chalk.green(`[RESTART] Bot ${instanceId} restarted successfully`));
          } catch (e) {
            console.error(`[RESTART] Failed to restart bot ${instanceId}:`, e.message);
          }
        }, 5000);
      }
    });

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
    const thirtyMinsAgo = useSQLite ? "DATETIME('now', '-30 minutes')" : "NOW() - INTERVAL '30 minutes'";

    // 1. Delete pending bots offline for >30 mins
    const pendingResult = await executeQuery(`
      DELETE FROM bot_instances
      WHERE start_status = 'new'
      AND status = 'offline'
      AND updated_at <= ${thirtyMinsAgo}
      AND server_name = $1
      RETURNING id
    `, [SERVERNAME]);

    if (pendingResult.rows && pendingResult.rows.length > 0) {
      for (const row of pendingResult.rows) {
        console.log(`🗑️ Pending bot ${row.id} deleted (offline for >30m)`);
      }
    }

    // 2. Handle expired bots
    const result = await executeQuery(`
      UPDATE bot_instances
      SET start_status = 'expired', updated_at = ${nowFunc}
      WHERE start_status = 'approved' 
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
      WHERE server_name = $1 AND start_status = 'approved'
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

/**
 * @swagger
 * /api/server-info:
 *   get:
 *     summary: Get server information
 *     responses:
 *       200:
 *         description: Server info
 */
app.get('/api/server-info', async (req, res) => {
  try {
    const total = await executeQuery('SELECT COUNT(*) as count FROM bot_instances WHERE server_name = $1', [SERVERNAME]);
    const newBots = await executeQuery("SELECT COUNT(*) as count FROM bot_instances WHERE server_name = $1 AND start_status = 'new'", [SERVERNAME]);
    const approved = await executeQuery("SELECT COUNT(*) as count FROM bot_instances WHERE server_name = $1 AND start_status = 'approved'", [SERVERNAME]);
    const expired = await executeQuery("SELECT COUNT(*) as count FROM bot_instances WHERE server_name = $1 AND start_status = 'expired'", [SERVERNAME]);
    
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

// const os = require('os'); (duplicated)

let pm2 = null;
let pm2Connected = false;

try {
  pm2 = require('pm2');
  pm2.connect((err) => {
    if (err) {
      console.log('PM2 connection failed:', err.message);
      pm2Connected = false;
    } else {
      pm2Connected = true;
      console.log('PM2 connected for process monitoring');
    }
  });
} catch (e) {
  console.log('PM2 not available, using fallback');
}

const RAM_MANAGER = {
  totalRAM: os.totalmem(),
  lastCpuInfo: null,
  getTotalRAM() {
    return this.totalRAM;
  },
  getUsedRAM() {
    return this.totalRAM - os.freemem();
  },
  getFreeRAM() {
    return os.freemem();
  },
  async getAllocatedRAMSync() {
    if (pm2 && pm2Connected) {
      return new Promise((resolve) => {
        pm2.list((err, list) => {
          let allocated = 0;
          if (!err && list) {
            for (const proc of list) {
              if (proc.name && proc.name.startsWith('instance')) {
                allocated += proc.monit?.memory || 0;
              }
            }
          }
          resolve(allocated);
        });
      });
    }
    
    let allocated = 0;
    for (const [instanceId, proc] of Object.entries(botProcesses)) {
      try {
        if (proc.pid) {
          try {
            const { execSync } = require('child_process');
            const output = execSync(`ps -p ${proc.pid} -o rss=`, { encoding: 'utf8', timeout: 5000 });
            const rss = parseInt(output.trim()) * 1024;
            if (!isNaN(rss)) allocated += rss;
          } catch (e) {}
        }
      } catch (e) {}
    }
    return allocated;
  },
  getCPUUsage() {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    
    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    }
    
    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;
    const usage = 100 - (100 * idle / total);
    
    return Math.round(usage);
  },
  async getInfo() {
    const total = this.getTotalRAM();
    const allocated = await this.getAllocatedRAMSync();
    const free = this.getFreeRAM();
    const used = this.getUsedRAM();
    const cpuUsage = this.getCPUUsage();
    const cpus = os.cpus().length;
    const loadAvg = os.loadavg();
    
    let pm2Processes = [];
    if (pm2 && pm2Connected) {
      try {
        pm2.list((err, list) => {
          if (!err && list) {
            pm2Processes = list.map(p => ({
              name: p.name,
              pid: p.pid,
              memory: p.monit?.memory || 0,
              cpu: p.monit?.cpu || 0,
              status: p.pm2_env?.status || 'unknown'
            }));
          }
        });
      } catch (e) {}
    }
    
    return {
      total_bytes: total,
      total_mb: Math.round(total / 1024 / 1024),
      total_gb: (total / 1024 / 1024 / 1024).toFixed(2),
      allocated_bytes: allocated,
      allocated_mb: Math.round(allocated / 1024 / 1024),
      allocated_gb: (allocated / 1024 / 1024 / 1024).toFixed(2),
      free_bytes: free,
      free_mb: Math.round(free / 1024 / 1024),
      free_gb: (free / 1024 / 1024 / 1024).toFixed(2),
      used_bytes: used,
      used_mb: Math.round(used / 1024 / 1024),
      used_gb: (used / 1024 / 1024 / 1024).toFixed(2),
      usage_percent: Math.round((used / total) * 100),
      allocated_percent: Math.round((allocated / total) * 100),
      cpu_usage: cpuUsage,
      cpu_cores: cpus,
      load_avg: loadAvg.map(l => l.toFixed(2)),
      pm2_processes: pm2Processes,
      pm2_connected: pm2Connected
    };
  }
};

app.get('/api/ram-info', async (req, res) => {
  const info = await RAM_MANAGER.getInfo();
  res.json(info);
});

const RAM_RESTART_THRESHOLD = 999;

async function checkRamAndRestartBots() {
  // Disabled - RAM restart functionality removed
}

// setInterval(checkRamAndRestartBots, 10000);

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
      start_status: instance.start_status,
      server_name: instance.server_name,
      port: instance.port,
      created_at: instance.created_at,
      expires_at: instance.expires_at
    });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

/**
 * @swagger
 * /api/instances/{instanceId}/pair:
 *   post:
 *     summary: Generate pairing code for existing bot
 *     parameters:
 *       - in: path
 *         name: instanceId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Pairing code generated
 */
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
    
    // Check if current server is full
    const serverLimitResult = await executeQuery('SELECT bot_count, max_limit FROM server_manager WHERE server_name = $1', [SERVERNAME]);
    const isFull = serverLimitResult.rows[0] && serverLimitResult.rows[0].bot_count >= serverLimitResult.rows[0].max_limit;

    // Load balance if full or if it's a new registration
    let finalServer = botServer;
    if (isFull || instance.start_status === 'new') {
      finalServer = await findAvailableServer();
      await executeQuery('UPDATE bot_instances SET server_name = $1 WHERE id = $2', [finalServer, instanceId]);
    }
    
    // Assign port if not exists
    if (!port) {
      port = getNextPort();
      await executeQuery('UPDATE bot_instances SET port = $1 WHERE id = $2', [port, instanceId]);
    }
    
    // Maintain existing start_status if it exists, otherwise set to 'new'
    if (!instance.start_status) {
      await executeQuery("UPDATE bot_instances SET start_status = 'new' WHERE id = $1", [instanceId]);
    } else if (instance.start_status !== 'approved' && instance.start_status !== 'expired') {
      // If it's anything else (like 'new' or null), ensure it's 'new'
      await executeQuery("UPDATE bot_instances SET start_status = 'new' WHERE id = $1", [instanceId]);
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
    
    // Start globalpair if not running
    await startGlobalPairServer();
    
    // Use external global pairing server
    const pairingServerUrl = 'http://localhost:9000';
    
    try {
      const response = await axios.get(`${pairingServerUrl}/?number=${instance.phone_number}&instanceId=${instanceId}`, {
        timeout: 120000
      });
      
      if (response.data && response.data.code) {
        console.log(chalk.green(`🔑 [PAIRING-EXTERNAL] Generated code for ${instanceId}: ${response.data.code}`));
        return res.json({
          pairing_code: response.data.code,
          instance_id: instanceId,
          server_name: botServer,
          message: 'Use this code to pair. Bot will connect automatically once paired.'
        });
      }
    } catch (e) {
      console.error('External pairing error:', e.message);
      return res.status(500).json({ detail: 'Failed to get pairing code from external server' });
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
    const existing = await executeQuery('SELECT id, start_status FROM bot_instances WHERE phone_number = $1', [phone_number]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ detail: 'Bot already exists for this phone number. Use pair endpoint instead.' });
    }
    
    // Find best server
    const targetServer = await findAvailableServer();
    const instanceId = uuidv4().substring(0, 8);
    const port = getNextPort();
    
    // Cleanup any existing instance first - stop process and delete directory
    const botDir = path.join(__dirname, '..', 'bot');
    const existingInstanceDir = path.join(botDir, 'instances', instanceId);
    
    // Stop any existing process
    const existingResult = await executeQuery('SELECT pid, port FROM bot_instances WHERE phone_number = $1', [phone_number]);
    if (existingResult.rows.length > 0) {
      const existingPid = existingResult.rows[0].pid;
      const existingPort = existingResult.rows[0].port;
      if (existingPid) {
        try { process.kill(existingPid); } catch (e) {}
      }
      // Also try to kill via port if exists
      if (existingPort) {
        try {
          await fetch(`http://127.0.0.1:${existingPort}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(2000) }).catch(() => {});
        } catch (e) {}
      }
      // Delete existing instance directory completely
      if (fs.existsSync(existingInstanceDir)) {
        fs.rmSync(existingInstanceDir, { recursive: true, force: true });
      }
      // Update existing record instead of creating new
      await executeQuery(
        'UPDATE bot_instances SET status = $1, start_status = $2, session_data = NULL, server_name = $3, port = $4 WHERE phone_number = $5',
        ['new', 'new', targetServer, port, phone_number]
      );
    } else {
      // Create new in database
      await executeQuery(
        'INSERT INTO bot_instances (id, name, phone_number, status, start_status, server_name, port) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [instanceId, name, phone_number, 'new', 'new', targetServer, port]
      );
    }
    
    // Setup fresh directories (always delete and recreate)
    const instanceDir = path.join(botDir, 'instances', instanceId);
    if (fs.existsSync(instanceDir)) {
      fs.rmSync(instanceDir, { recursive: true, force: true });
    }
    fs.mkdirSync(path.join(instanceDir, 'session'), { recursive: true });
    fs.mkdirSync(path.join(instanceDir, 'data'), { recursive: true });
    
    // Check if current server is full
    const serverLimitResult = await executeQuery('SELECT bot_count, max_limit FROM server_manager WHERE server_name = $1', [SERVERNAME]);
    const isFull = serverLimitResult.rows[0] && serverLimitResult.rows[0].bot_count >= serverLimitResult.rows[0].max_limit;

    // If full, we still run it temporarily for pairing on THIS server, 
    // but find another server for permanent registration in the registry
    if (isFull) {
      const permanentServer = await findAvailableServer();
      if (permanentServer !== SERVERNAME) {
        await executeQuery('UPDATE bot_instances SET server_name = $1 WHERE id = $2', [permanentServer, instanceId]);
        console.log(`⚖️ Server ${SERVERNAME} is full. Bot ${instanceId} temporarily running here for pairing, but registered to ${permanentServer} for next restart.`);
      }
    }

    // Start globalpair if not running
    await startGlobalPairServer();
    
    // Use external global pairing server
    const pairingServerUrl = 'http://localhost:9000';
    
    try {
      const response = await axios.get(`${pairingServerUrl}/?number=${phone_number}&instanceId=${instanceId}`, {
        timeout: 120000
      });
      
      if (response.data && response.data.code) {
        console.log(chalk.green(`🔑 [PAIRING-EXTERNAL] Generated code for ${instanceId}: ${response.data.code}`));
        return res.json({
          id: instanceId,
          pairing_code: response.data.code,
          server_name: targetServer,
          port,
          message: 'Use this code to pair. Bot will connect automatically once paired.'
        });
      }
    } catch (e) {
      console.error('External pairing error:', e.message);
      return res.status(500).json({ detail: 'Failed to get pairing code from external server' });
    }
  } catch (e) {
    console.error('Pair-new error:', e);
    res.status(500).json({ detail: e.message });
  }
});

/**
 * @swagger
 * /api/instances:
 *   post:
 *     summary: Create a new bot instance
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               phone_number:
 *                 type: string
 *     responses:
 *       200:
 *         description: Instance created
 */
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
        SET name = $1, owner_id = $2, port = $3, status = 'new', start_status = 'new', updated_at = ${updateNow} 
        WHERE id = $4
      `, [name, owner_id, port, instanceId]);
    } else {
      targetServer = await findAvailableServer();
      instanceId = uuidv4().substring(0, 8);
      port = getNextPort();
      
      await executeQuery(
        'INSERT INTO bot_instances (id, name, phone_number, status, start_status, server_name, owner_id, port) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [instanceId, name, phone_number, 'new', 'new', targetServer, owner_id, port]
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

    // Ensure instance is running before trying to regenerate code
    let isAlive = false;
    try {
      const checkRes = await axios.get(`http://127.0.0.1:${port}/status`, { timeout: 2000 });
      isAlive = checkRes.status === 200;
    } catch (e) {
      isAlive = false;
    }

    if (!isAlive || !botProcesses[instanceId]) {
      console.log(chalk.yellow(`[REGENERATE] Bot ${instanceId} is offline or unresponsive, starting/restarting...`));
      await stopInstance(instanceId);
      await startInstanceInternal(instanceId, instance.phone_number, port, instance.session_data);
      // Wait for it to boot up and establish initial WS connection
      await new Promise(r => setTimeout(r, 15000));
    }

    try {
      const hosts = ['127.0.0.1', 'localhost', '0.0.0.0'];
      let response;
      let lastError;

      // Multiple retry attempts
      for (let attempt = 0; attempt < 3; attempt++) {
        for (const host of hosts) {
          try {
            response = await axios.post(`http://${host}:${port}/regenerate-code`, {}, { timeout: 10000 });
            break;
          } catch (e) {
            lastError = e;
          }
        }
        if (response) break;
        console.log(`[REGENERATE] Attempt ${attempt + 1} failed for ${instanceId}, retrying...`);
        await new Promise(r => setTimeout(r, 3000));
      }
      
      // After regenerating, also trigger pairing process
      for (const host of hosts) {
        try {
          await axios.post(`http://${host}:${port}/trigger-pairing`, {}, { timeout: 10000 });
          break;
        } catch (e) {
          console.log(`Trigger pairing failed on ${host}: ${e.message}`);
        }
      }
      
      await new Promise(r => setTimeout(r, 3000));
      
      if (!response) {
        throw lastError || new Error('All hosts and attempts failed');
      }
      
      return res.json(response.data);
    } catch (axiosError) {
      console.error(`Error connecting to bot instance on port ${port}:`, axiosError.message);
      return res.status(500).json({ detail: `Bot instance communication failed: ${axiosError.message}` });
    }
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
      await new Promise(r => setTimeout(r, 10000)); // Increased wait time
    }

    try {
      // Try localhost first, then 127.0.0.1
      let response;
      try {
        response = await axios.get(`http://localhost:${port}/pairing-code`, { timeout: 20000 });
      } catch (e) {
        response = await axios.get(`http://127.0.0.1:${port}/pairing-code`, { timeout: 20000 });
      }
      const data = response.data;
      res.json({ pairing_code: data.pairingCode, pairingCode: data.pairingCode, status: data.status });
    } catch (axiosError) {
      res.status(500).json({ detail: `Bot instance communication failed: ${axiosError.message}` });
    }
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
      // If status is disconnected or unauthorized, ensure it's reflected correctly
      const finalStatus = (status === 'unauthorized' || status === 'disconnected') ? 'offline' : status;
      query += `, status = $${paramIdx++}`;
      params.push(finalStatus);
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

/**
 * @swagger
 * /api/instances/{instanceId}/start:
 *   post:
 *     summary: Start a bot instance
 *     parameters:
 *       - in: path
 *         name: instanceId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Bot started
 */
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

/**
 * @swagger
 * /api/instances/{instanceId}/stop:
 *   post:
 *     summary: Stop a bot instance
 *     parameters:
 *       - in: path
 *         name: instanceId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Bot stopped
 */
app.post('/api/instances/:instanceId/stop', async (req, res) => {
  try {
    await stopInstance(req.params.instanceId);
    res.json({ message: 'Instance stopped' });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

app.post('/api/instances/start-after-pairing', async (req, res) => {
  try {
    const { instanceId, phone_number } = req.body;
    
    if (!instanceId) {
      return res.status(400).json({ detail: 'instanceId is required' });
    }
    
    // Get instance info
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
    
    // Check if session files exist in local directory
    const botDir = path.join(__dirname, '..', 'bot');
    const sessionDir = path.join(botDir, 'instances', instanceId, 'session');
    const sessionExists = fs.existsSync(sessionDir) && fs.readdirSync(sessionDir).length > 0;
    
    // Read session from local files if exists
    let sessionData = null;
    if (sessionExists) {
      console.log(chalk.blue(`📁 Session files found locally for ${instanceId}`));
    } else if (instance.session_data) {
      // Fallback to DB session
      console.log(chalk.blue(`📦 Session data found in DB for ${instanceId}`));
      sessionData = instance.session_data;
    }
    
    // Update status to connecting
    await executeQuery("UPDATE bot_instances SET status = 'connecting', start_status = 'new' WHERE id = $1", [instanceId]);
    
    // Start the instance with session data
    const started = await startInstanceInternal(instanceId, instance.phone_number || phone_number, port, sessionData);
    
    if (started) {
      // Update status to connected after a delay
      setTimeout(async () => {
        try {
          await executeQuery("UPDATE bot_instances SET status = 'connected' WHERE id = $1", [instanceId]);
          console.log(chalk.green(`✅ Bot ${instanceId} status updated to connected`));
        } catch (err) {
          console.error(`❌ Failed to update bot status: ${err.message}`);
        }
      }, 10000);
      
      res.json({ message: 'Bot started after pairing', instanceId, port });
    } else {
      res.status(500).json({ detail: 'Failed to start bot' });
    }
  } catch (e) {
    console.error('Error starting bot after pairing:', e);
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
    const { status, start_status, id, all_servers } = req.query;
    let result;
    
    const useAllServers = all_servers === 'true';
    
    if (id) {
      result = await executeQuery('SELECT * FROM bot_instances WHERE id = $1', [id]);
    } else if (start_status) {
      result = await executeQuery('SELECT * FROM bot_instances WHERE start_status = $1 ORDER BY created_at DESC', [start_status]);
    } else if (status) {
      if (status === 'approved') {
        result = await executeQuery("SELECT * FROM bot_instances WHERE start_status = 'approved' ORDER BY created_at DESC");
      } else {
        result = await executeQuery('SELECT * FROM bot_instances WHERE status = $1 ORDER BY created_at DESC', [status]);
      }
    } else {
      result = await executeQuery('SELECT * FROM bot_instances ORDER BY created_at DESC');
    }

    const instances = [];
    for (const instance of result.rows) {
      let statusData = { status: instance.status, pairingCode: null, user: null };
      
      if (instance.start_status === 'approved' && instance.port) {
        if (instance.server_name === SERVERNAME) {
          statusData = await getInstanceStatus(instance.id, instance.port);
        }
      }

      instances.push({
        id: instance.id,
        name: instance.name,
        phone_number: instance.phone_number,
        status: statusData.status || instance.status,
        start_status: instance.start_status,
        server_name: instance.server_name,
        owner_id: instance.owner_id,
        port: instance.port,
        pairing_code: statusData.pairingCode,
        connected_user: instance.phone_number,
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
      SET start_status = 'approved', 
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

// Serve static pairing page from public directory
app.use(express.static(path.join(__dirname, '..', 'public')));

// Chatbot configuration API endpoints
app.put('/api/instances/:instanceId/chatbot', async (req, res) => {
  try {
    const { instanceId } = req.params;
    const { chatbot_enabled, chatbot_api_key, chatbot_base_url, sec_db_pass } = req.body;

    const result = await executeQuery('SELECT * FROM bot_instances WHERE id = $1', [instanceId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ detail: 'Instance not found' });
    }

    const instance = result.rows[0];

    const nowFunc = useSQLite ? 'CURRENT_TIMESTAMP' : 'NOW()';
    await executeQuery(`
      UPDATE bot_instances 
      SET chatbot_enabled = $1,
          chatbot_api_key = $2,
          chatbot_base_url = $3,
          sec_db_pass = $4,
          updated_at = ${nowFunc}
      WHERE id = $5
    `, [chatbot_enabled, chatbot_api_key, chatbot_base_url, sec_db_pass, instanceId]);

    // Reload chatbot config on the bot instance without restarting
    if (instance.port && instance.server_name === SERVERNAME && botProcesses[instanceId]) {
      try {
        const hosts = ['0.0.0.0', '127.0.0.1', 'localhost'];
        for (const host of hosts) {
          try {
            await axios.get(`http://${host}:${instance.port}/reload-chatbot`, { timeout: 5000 });
            break;
          } catch (e) {
            // Continue to next host
          }
        }
      } catch (e) {
        console.error('Failed to reload chatbot on bot instance:', e.message);
      }
    }

    res.json({ success: true, message: 'Chatbot configuration updated' });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

app.get('/api/instances/:instanceId/chatbot', async (req, res) => {
  try {
    const { instanceId } = req.params;

    const result = await executeQuery(
      'SELECT chatbot_enabled, chatbot_api_key, chatbot_base_url, sec_db_pass FROM bot_instances WHERE id = $1', 
      [instanceId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ detail: 'Instance not found' });
    }

    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

// Global chatbot config for all bots
app.get('/api/chatbot/global-config', async (req, res) => {
  try {
    const result = await executeQuery('SELECT * FROM global_chatbot_config WHERE id = 1');
    if (result.rows.length === 0) {
      return res.json({});
    }
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

app.put('/api/chatbot/global-config', async (req, res) => {
  try {
    const { chatbot_api_key, chatbot_base_url, sec_db_host, sec_db_port, sec_db_name, sec_db_user, sec_db_pass } = req.body;

    const nowFunc = useSQLite ? 'CURRENT_TIMESTAMP' : 'NOW()';
    await executeQuery(`
      INSERT INTO global_chatbot_config (id, chatbot_api_key, chatbot_base_url, sec_db_host, sec_db_port, sec_db_name, sec_db_user, sec_db_pass, updated_at)
      VALUES (1, $1, $2, $3, $4, $5, $6, $7, ${nowFunc})
      ON CONFLICT (id) DO UPDATE SET
        chatbot_api_key = $1,
        chatbot_base_url = $2,
        sec_db_host = $3,
        sec_db_port = $4,
        sec_db_name = $5,
        sec_db_user = $6,
        sec_db_pass = $7,
        updated_at = ${nowFunc}
    `, [chatbot_api_key, chatbot_base_url, sec_db_host, sec_db_port || 5432, sec_db_name || 'crate', sec_db_user || 'admin', sec_db_pass]);

    res.json({ success: true, message: 'Global chatbot configuration updated' });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

// HTML Form POST handler for pairing (works without JavaScript)
// Supports both new bots and re-pairing existing offline/connecting bots
app.post('/pair', async (req, res) => {
  try {
    const { name, phone_number } = req.body;
    
    if (!name || !phone_number) {
      return res.send(generatePairingResultHTML(null, 'Please provide both name and phone number.'));
    }
    
    const cleanPhone = phone_number.replace(/[^0-9]/g, '');
    if (cleanPhone.length < 10) {
      return res.send(generatePairingResultHTML(null, 'Invalid phone number. Please include country code.'));
    }
    
    let instanceId, port, botName;
    const existing = await executeQuery('SELECT * FROM bot_instances WHERE phone_number = $1', [cleanPhone]);
    
    if (existing.rows.length > 0) {
      const existingBot = existing.rows[0];
      const botStatus = existingBot.status;
      
      // Check if session is actually valid by looking at session files
      const botDir = path.join(__dirname, '..', 'bot');
      const sessionDir = path.join(botDir, 'instances', existingBot.id, 'session');
      const credsFile = path.join(sessionDir, 'creds.json');
      let sessionValid = false;
      
      if (fs.existsSync(credsFile)) {
        try {
          const credsData = JSON.parse(fs.readFileSync(credsFile, 'utf-8'));
          // Check if creds have required keys and are not empty
          sessionValid = credsData && credsData.noiseKey && credsData.signedIdentityKey;
        } catch (e) {
          sessionValid = false;
        }
      }
      
      // Only allow re-pairing if session is invalid (not connected)
      // If session is valid and status is connected, block it
      if (botStatus === 'connected' && sessionValid) {
        return res.send(generatePairingResultHTML(null, 'This bot is already connected and active. No re-pairing needed.'));
      }
      
      // Session is invalid or not connected - allow re-pairing
      if (botStatus === 'connected' && !sessionValid) {
        console.log(chalk.yellow(`[PAIR-FORM] DB shows connected but session is invalid. Updating status to offline.`));
        await executeQuery('UPDATE bot_instances SET status = $1 WHERE id = $2', ['offline', existingBot.id]);
      }
      
      instanceId = existingBot.id;
      port = existingBot.port || getNextPort();
      botName = existingBot.name;
      
      console.log(chalk.yellow(`[PAIR-FORM] Re-pairing existing bot ${instanceId} (status: ${botStatus})`));
      
      await stopInstance(instanceId);
      
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
      fs.mkdirSync(sessionDir, { recursive: true });
      
      await executeQuery('UPDATE bot_instances SET session_data = NULL, status = $1, port = $2 WHERE id = $3', ['pairing', port, instanceId]);
      
    } else {
      const targetServer = await findAvailableServer();
      instanceId = uuidv4().substring(0, 8);
      port = getNextPort();
      botName = name;
      
      await executeQuery(
        'INSERT INTO bot_instances (id, name, phone_number, status, start_status, server_name, port) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [instanceId, name, cleanPhone, 'new', 'new', targetServer, port]
      );
      
      const botDir = path.join(__dirname, '..', 'bot');
      const instanceDir = path.join(botDir, 'instances', instanceId);
      fs.mkdirSync(path.join(instanceDir, 'session'), { recursive: true });
      fs.mkdirSync(path.join(instanceDir, 'data'), { recursive: true });
    }
    
    // Start globalpair if not running
    await startGlobalPairServer();
    
    // Use globalpair server for pairing
    const pairingServerUrl = 'http://localhost:9000';
    
    try {
      const response = await axios.get(`${pairingServerUrl}/?number=${cleanPhone}&instanceId=${instanceId}`, {
        timeout: 120000
      });
      
      if (response.data && response.data.code) {
        console.log(chalk.green(`[PAIR-FORM] Generated code for ${instanceId}: ${response.data.code}`));
        return res.send(generatePairingResultHTML(response.data.code, null, botName, cleanPhone, instanceId));
      }
    } catch (e) {
      console.error('Pairing error:', e.message);
      return res.send(generatePairingResultHTML(null, 'Failed to generate pairing code. Please try again.'));
    }
    
  } catch (e) {
    console.error('Pair form error:', e);
    res.send(generatePairingResultHTML(null, 'An error occurred. Please try again later.'));
  }
});

function generatePairingResultHTML(pairingCode, error, name, phone, instanceId) {
  const styles = `
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }
      .container {
        background: white;
        border-radius: 16px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        padding: 40px;
        width: 100%;
        max-width: 450px;
        text-align: center;
      }
      .logo h1 { color: #25D366; font-size: 28px; margin-bottom: 8px; }
      .logo p { color: #666; font-size: 14px; margin-bottom: 30px; }
      .pairing-code {
        background: #f0fff4;
        border: 3px dashed #25D366;
        border-radius: 12px;
        padding: 30px;
        margin: 20px 0;
      }
      .pairing-code h2 { color: #333; font-size: 16px; margin-bottom: 15px; }
      .code {
        font-size: 36px;
        font-weight: bold;
        color: #25D366;
        letter-spacing: 8px;
        font-family: 'Courier New', monospace;
      }
      .error-box {
        background: #fff5f5;
        border: 2px solid #fc8181;
        border-radius: 12px;
        padding: 20px;
        margin: 20px 0;
        color: #c53030;
      }
      .info { color: #666; font-size: 14px; margin: 15px 0; line-height: 1.6; }
      .details { background: #f7fafc; border-radius: 8px; padding: 15px; margin: 20px 0; text-align: left; }
      .details p { font-size: 13px; color: #4a5568; margin: 5px 0; }
      .details strong { color: #2d3748; }
      .back-link {
        display: inline-block;
        margin-top: 25px;
        padding: 14px 30px;
        background: #25D366;
        color: white;
        text-decoration: none;
        border-radius: 10px;
        font-weight: 600;
      }
      .back-link:hover { background: #1ea952; }
      .instructions { background: #f8f9fa; border-radius: 10px; padding: 20px; margin-top: 25px; text-align: left; }
      .instructions h3 { color: #333; font-size: 14px; margin-bottom: 12px; }
      .instructions ol { padding-left: 20px; color: #666; font-size: 13px; line-height: 1.8; }
    </style>
  `;
  
  if (error) {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Pairing Error</title>${styles}</head><body>
      <div class="container">
        <div class="logo"><h1>TREKKER WABOT</h1><p>Pairing Service</p></div>
        <div class="error-box"><strong>Error:</strong> ${error}</div>
        <a href="/" class="back-link">Try Again</a>
      </div>
    </body></html>`;
  }
  
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Pairing Code</title>${styles}</head><body>
    <div class="container">
      <div class="logo"><h1>TREKKER WABOT</h1><p>Pairing Code Generated</p></div>
      <div class="pairing-code">
        <h2>Your Pairing Code</h2>
        <div class="code">${pairingCode}</div>
      </div>
      <div class="details">
        <p><strong>Bot Name:</strong> ${name}</p>
        <p><strong>Phone:</strong> ${phone}</p>
        <p><strong>Instance ID:</strong> ${instanceId}</p>
      </div>
      <div class="instructions">
        <h3>To complete pairing:</h3>
        <ol>
          <li>Open WhatsApp on your phone</li>
          <li>Go to Settings > Linked Devices</li>
          <li>Tap "Link a Device"</li>
          <li>Choose "Link with phone number instead"</li>
          <li>Enter the code shown above</li>
        </ol>
      </div>
      <p class="info">This code expires in a few minutes. If it expires, create a new pairing request.</p>
      <a href="/" class="back-link">Pair Another Device</a>
    </div>
  </body></html>`;
}

// Server static files from the React app - only when WEB is enabled
if (WEB_ENABLED) {
  app.use(express.static(path.join(__dirname, 'static')));
}

// The "catchall" handler: for any request that doesn't
// match one above, send back React's index.html file.
app.get(/^(?!\/api).*/, (req, res) => {
    const publicIndexPath = path.join(__dirname, '..', 'public', 'index.html');
    if (fs.existsSync(publicIndexPath)) {
        res.sendFile(publicIndexPath);
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
    
    // Start approved and new bots on this server (skip offline ones)
    const result = await executeQuery("SELECT * FROM bot_instances WHERE (start_status = 'approved' OR start_status = 'new') AND server_name = $1 AND status != 'offline'", [SERVERNAME]);
    console.log(`🚀 Starting ${result.rows.length} bots from database...`);
    for (const bot of result.rows) {
      const isDevMode = bot.start_status === 'new';
      if (isDevMode) console.log(chalk.yellow(`🛠️ Bot ${bot.id} starting as NEW/PENDING (Phone: ${bot.phone_number})`));
      startInstanceInternal(bot.id, bot.phone_number, bot.port, bot.session_data, isDevMode);
    }

    // Intervals
    setInterval(checkExpiredBots, 10 * 60 * 1000); // 10 mins
    setInterval(updateServerStatus, 60 * 1000); // 1 min

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`
=========================================
🛡️  TREKKER WABOT Backend Running
📍  Port: ${PORT}
👤  Admin: ${ADMIN_USERNAME}
📦  Database: ${useSQLite ? 'SQLite' : 'PostgreSQL'}
🌍  Server Name: ${SERVERNAME}
🖥️  Dashboard: ${WEB_ENABLED ? 'ENABLED' : 'DISABLED (pairing only)'}
=========================================
      `);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
