if (!globalThis.crypto) {
    globalThis.crypto = require('crypto').webcrypto;
}
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const os = require('os');
const chalk = {
  blue: (text) => `\x1b[34m${text}\x1b[0m`,
  green: (text) => `\x1b[32m${text}\x1b[0m`,
  red: (text) => `\x1b[31m${text}\x1b[0m`,
  redBright: (text) => `\x1b[31m\x1b[1m${text}\x1b[0m`,
  yellow: (text) => `\x1b[33m${text}\x1b[0m`,
  cyan: (text) => `\x1b[36m${text}\x1b[0m`,
  magenta: (text) => `\x1b[35m${text}\x1b[0m`,
  gray: (text) => `\x1b[90m${text}\x1b[0m`,
  bold: (text) => `\x1b[1m${text}\x1b[0m`
};

let makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, proto, makeCacheableSignalKeyStore, delay, Browsers, BufferJSON, isJidNewsletter, getAggregateVotesInPollMessage, jidNormalizedUser, jidDecode;
let PhoneNumber;

const store = {
  messages: new Map(),
  maxPerChat: 5,
  maxChats: 20,
  chatOrder: [],

  bind: (ev) => {
    ev.on('messages.upsert', ({ messages }) => {
      for (const msg of messages) {
        if (!msg.key?.id) continue;
        if (msg.messageStubType) continue;
        if (msg.pushName === undefined && !msg.message) continue;

        const jid = msg.key.remoteJid;
        if (!store.messages.has(jid)) {
          if (store.chatOrder.length >= store.maxChats) {
            const oldestJid = store.chatOrder.shift();
            store.messages.delete(oldestJid);
          }
          store.messages.set(jid, new Map());
          store.chatOrder.push(jid);
        }

        const chatMsgs = store.messages.get(jid);
        chatMsgs.set(msg.key.id, msg);

        if (chatMsgs.size > store.maxPerChat) {
          const oldestKey = chatMsgs.keys().next().value;
          chatMsgs.delete(oldestKey);
        }
      }
    });
  },

  loadMessage: async (jid, id) => {
    return store.messages.get(jid)?.get(id) || null;
  }
};

const processedMessages = new Set();

setInterval(() => {
  processedMessages.clear();
}, 5 * 60 * 1000);

async function loadBaileys() {
    const baileys = await import("@whiskeysockets/baileys");
    makeWASocket = baileys.default;
    useMultiFileAuthState = baileys.useMultiFileAuthState;
    DisconnectReason = baileys.DisconnectReason;
    fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
    proto = baileys.proto;
    makeCacheableSignalKeyStore = baileys.makeCacheableSignalKeyStore;
    delay = baileys.delay;
    Browsers = baileys.Browsers;
    BufferJSON = baileys.BufferJSON;
    isJidNewsletter = baileys.isJidNewsletter;
    getAggregateVotesInPollMessage = baileys.getAggregateVotesInPollMessage;
    jidNormalizedUser = baileys.jidNormalizedUser;
    jidDecode = baileys.jidDecode;
    try {
        const phoneNumberUtil = await import('google-libphonenumber');
        PhoneNumber = phoneNumberUtil.PhoneNumberUtil.getInstance;
    } catch (e) {
        PhoneNumber = null;
    }
}

const messageStore = new Map();
const NodeCache = require("node-cache");
const pino = require("pino");
const http = require('http');
const url = require('url');

const createSuppressedLogger = (level = 'silent') => {
  const forbiddenPatterns = [
    'closing session',
    'closing open session',
    'sessionentry',
    'prekey bundle',
    'pendingprekey',
    '_chains',
    'registrationid',
    'currentratchet',
    'chainkey',
    'ratchet',
    'signal protocol',
    'ephemeralkeypair',
    'indexinfo',
    'basekey',
    'sessionentry',
    'ratchetkey'
  ];

  let logger;
  try {
    logger = pino({
      level,
      transport: process.env.NODE_ENV === 'production' ? undefined : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          ignore: 'pid,hostname'
        }
      },
      customLevels: {
        trace: 0,
        debug: 1,
        info: 2,
        warn: 3,
        error: 4,
        fatal: 5
      },
      redact: ['registrationId', 'ephemeralKeyPair', 'rootKey', 'chainKey', 'baseKey']
    });
  } catch (err) {
    logger = pino({ level });
  }

  const originalInfo = logger.info.bind(logger);
  logger.info = (...args) => {
    const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ').toLowerCase();
    if (!forbiddenPatterns.some(pattern => msg.includes(pattern))) {
      originalInfo(...args);
    }
  };
  logger.debug = () => { };
  logger.trace = () => { };
  return logger;
};

const args = process.argv.slice(2);
const instanceId = args[0] || 'default';
const phoneNumber = args[1] || '';
let apiPort = parseInt(args[2]) || 3001;

// Validate port range
if (apiPort >= 65536 || apiPort < 1024) {
    apiPort = 4000 + Math.floor(Math.random() * 1000);
    console.log(chalk.yellow(`⚠️ Invalid port received, using random port: ${apiPort}`));
}

const SERVER_NAME = process.env.SERVERNAME || process.env.SERVER_NAME || 'server3';
let dbPool;
const DATABASE_URL = process.env.DATABASE_URL;

// Uptime file handling - for startup message
const UPTIME_FILE = path.join(__dirname, 'data', 'uptime.json');

function getBotStartTime() {
    try {
        if (fs.existsSync(UPTIME_FILE)) {
            const data = JSON.parse(fs.readFileSync(UPTIME_FILE, 'utf8'));
            return data.startTime;
        }
    } catch (e) {
        console.error('Error reading uptime file:', e);
    }
    return null;
}

function setBotStartTime() {
    try {
        const dir = path.join(__dirname, 'data');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const time = Date.now();
        fs.writeFileSync(UPTIME_FILE, JSON.stringify({ startTime: time }, null, 2));
        return time;
    } catch (e) {
        console.error('Error writing uptime file:', e);
        return Date.now();
    }
}

// Declare startTime for uptime tracking
let startTime = Date.now();

// Initialize startTime from file or create new
const savedStartTime = getBotStartTime();
if (savedStartTime) {
    startTime = savedStartTime;
} else {
    startTime = setBotStartTime();
}

function formatUptime(seconds) {
    const days = Math.floor(seconds / (24 * 60 * 60));
    seconds = seconds % (24 * 60 * 60);
    const hours = Math.floor(seconds / (60 * 60));
    seconds = seconds % (60 * 60);
    const minutes = Math.floor(seconds / 60);
    seconds = Math.floor(seconds % 60);

    let time = '';
    if (days > 0) time += `${days}d `;
    if (hours > 0) time += `${hours}h `;
    if (minutes > 0) time += `${minutes}m `;
    if (seconds > 0 || time === '') time += `${seconds}s`;

    return time.trim();
}

if (DATABASE_URL) {
    dbPool = new (require('pg').Pool)({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
}

async function syncSessionToDb(sessionData) {
    if (!dbPool) return false;
    
    try {
        const credsJson = JSON.stringify(sessionData);
        await dbPool.query(
            `UPDATE bot_instances SET session_data = $1, status = 'connected', updated_at = NOW() WHERE id = $2`,
            [credsJson, instanceId]
        );
        return true;
    } catch (err) {
        console.error('Error syncing session to DB:', err.message);
        return false;
    }
}

global.instanceId = instanceId;
global.chatbotEnabled = false;

const instanceDir = path.join(__dirname, 'instances', instanceId);
const sessionDir = path.join(instanceDir, 'session');
const dataDir = path.join(instanceDir, 'data');

let connectionStatus = 'initializing';
let botSocket = null;
let lastStatusSync = 0;
const SYNC_INTERVAL = 60 * 60 * 1000;
let connectionRetryCount = 0;
const MAX_RETRY_COUNT = 15;
let isReconnecting = false;
let viewedStatuses = new Set();

setInterval(() => {
    viewedStatuses?.clear();
}, 6 * 60 * 60 * 1000);

function removeFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) return false;
        fs.rmSync(filePath, { recursive: true, force: true });
        return true;
    } catch (e) {
        console.error('Error removing file:', e);
        return false;
    }
}

function isSystemJid(jid) {
    if (!jid) return true;
    const systemPatterns = [
        'newsletter',
        'broadcast',
        '@newsletter',
        '@broadcast'
    ];
    return systemPatterns.some(pattern => jid.includes(pattern));
}

function cleanupPuppeteerCache() {
    try {
        const cacheDir = path.join(os.homedir(), '.cache', 'puppeteer');
        if (fs.existsSync(cacheDir)) {
            console.log(chalk.yellow('🧹 Removing Puppeteer cache at:', cacheDir));
            fs.rmSync(cacheDir, { recursive: true, force: true });
            console.log(chalk.green('✅ Puppeteer cache removed'));
        }
    } catch (err) {
        console.error(chalk.red('⚠️ Failed to cleanup Puppeteer cache:'), err.message || err);
    }
}

const messageDeduplicationCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

function ensureDirectories() {
    if (!fs.existsSync(instanceDir)) fs.mkdirSync(instanceDir, { recursive: true });
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
        const defaultDataDir = path.join(__dirname, 'data');
        if (fs.existsSync(defaultDataDir)) {
            fs.readdirSync(defaultDataDir).forEach(file => {
                const src = path.join(defaultDataDir, file);
                const dest = path.join(dataDir, file);
                if (!fs.existsSync(dest)) {
                    fs.copyFileSync(src, dest);
                }
            });
        }
    }
}

console.log(chalk.cyan(`\n🚀 TREKKER MAX WABOT - Instance: ${instanceId}`));
console.log(chalk.cyan(`📁 Session Dir: ${sessionDir}`));

ensureDirectories();
cleanupPuppeteerCache();

const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    if (pathname === '/status' || pathname === '/status/') {
        res.writeHead(200);
        res.end(JSON.stringify({
            instanceId,
            status: connectionStatus,
            user: botSocket?.user || null,
            apiPort,
            uptime: Date.now() - startTime
        }));
        return;
    } else if (pathname === '/stop') {
        res.writeHead(200);
        res.end(JSON.stringify({ message: 'Stopping instance' }));
        setTimeout(() => process.exit(0), 1000);
    } else if (pathname === '/reload-chatbot' || pathname === '/reload-chatbot/') {
        try {
            const { Pool } = require('pg');
            const pool = new Pool({
                connectionString: process.env.DATABASE_URL || `sqlite://${path.join(__dirname, '..', 'backend', 'database.sqlite')}`
            });
            
            const result = await pool.query('SELECT chatbot_enabled, chatbot_api_key, chatbot_base_url, sec_db_pass FROM bot_instances WHERE id = $1', [instanceId]);
            if (result.rows.length > 0) {
                if (result.rows[0].chatbot_enabled !== null) global.chatbotEnabled = result.rows[0].chatbot_enabled;
                if (result.rows[0].chatbot_api_key) global.chatbotApiKey = result.rows[0].chatbot_api_key;
                if (result.rows[0].chatbot_base_url) global.chatbotBaseUrl = result.rows[0].chatbot_base_url;
                if (result.rows[0].sec_db_pass) global.secDbPass = result.rows[0].sec_db_pass;
                
                console.log(chalk.blue('🔄 Chatbot config reloaded: enabled=' + global.chatbotEnabled));
                res.writeHead(200);
                res.end(JSON.stringify({ 
                    success: true, 
                    chatbot_enabled: global.chatbotEnabled,
                    chatbot_api_key: global.chatbotApiKey ? 'configured' : null,
                    chatbot_base_url: global.chatbotBaseUrl ? 'configured' : null
                }));
            } else {
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'Instance not found' }));
            }
            await pool.end();
        } catch (e) {
            console.error('Error reloading chatbot config:', e.message);
            res.writeHead(500);
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
    }
});

server.listen(apiPort, '0.0.0.0', () => {
    console.log(chalk.green(`📡 Instance API running on port ${apiPort} (0.0.0.0)`));
});

async function sendStartupMessage(sock) {
    try {
        const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
        const now = Date.now();
        
        const userJid = jidNormalizedUser(phoneNumber + '@s.whatsapp.net');
        
        if (!dbPool) {
            const botName = sock?.user?.name || sock?.user?.pushName || 'TREKKER BOT';
            await sock.sendMessage(userJid, { 
                text: `
┏━━〔 🤖 ${botName} 〕━━┓
┃ ✅ Status    : Online
┃ ⏱️ Uptime   : 0s
┗━━━━━━━━━━━━━━━━━━━┛

Use .help or .menu to manage the bot`.trim()
            });
            return;
        }
        
        try {
            const result = await dbPool.query(
                'SELECT last_startup_message_sent, phone_number, created_at FROM bot_instances WHERE id = $1',
                [instanceId]
            );
            
            const lastSent = result.rows.length > 0 ? result.rows[0].last_startup_message_sent : 0;
            const botPhoneNumber = result.rows.length > 0 ? result.rows[0].phone_number : null;
            const botCreatedAt = result.rows.length > 0 ? result.rows[0].created_at : null;
            const timeSinceLastSent = now - (lastSent || 0);
            
            let targetJid = userJid;
            if (botPhoneNumber) {
                targetJid = jidNormalizedUser(botPhoneNumber + '@s.whatsapp.net');
                console.log(chalk.blue(`📱 Startup message will be sent to bot number: ${botPhoneNumber}`));
            } else {
                console.log(chalk.yellow('⚠️ No phone_number found, sending to userJid'));
            }
            
            if (!lastSent || timeSinceLastSent >= TWO_HOURS_MS) {
                // Use bot creation time from DB for uptime
                let botStartTime = startTime;
                if (botCreatedAt) {
                    botStartTime = new Date(botCreatedAt).getTime();
                }
                const uptimeMs = now - botStartTime;
                const uptimeInSeconds = Math.floor(uptimeMs / 1000);
                const days = Math.floor(uptimeInSeconds / (24 * 60 * 60));
                let secs = uptimeInSeconds % (24 * 60 * 60);
                const hours = Math.floor(secs / (60 * 60));
                secs = secs % (60 * 60);
                const minutes = Math.floor(secs / 60);
                secs = Math.floor(secs % 60);
                
                let uptimeStr = '';
                if (days > 0) uptimeStr += `${days}d `;
                if (hours > 0) uptimeStr += `${hours}h `;
                if (minutes > 0) uptimeStr += `${minutes}m `;
                if (secs > 0 || uptimeStr === '') uptimeStr += `${secs}s`;
                uptimeStr = uptimeStr.trim();
                
                const devSuffix = process.env.DEV_MODE === 'true' ? ' [DEV MODE]' : '';
                const botName = sock?.user?.name || sock?.user?.pushName || 'TREKKER BOT';
                
                const message = `
┏━━〔 🤖 ${botName} 〕━━┓
┃ ✅ Status    : Online${devSuffix}
┃ ⏱️ Uptime   : ${uptimeStr}
┃ 📱 Bot      : ${botPhoneNumber || 'N/A'}
┗━━━━━━━━━━━━━━━━━━━┛

Use .help or .menu to manage the bot`.trim();
                
                await sock.sendMessage(targetJid, { text: message });
                
                await dbPool.query(
                    'UPDATE bot_instances SET last_startup_message_sent = $1 WHERE id = $2',
                    [now, instanceId]
                ).catch(err => console.error('Error updating startup message timestamp:', err.message));
                
                console.log(chalk.green(`✅ Startup message sent to owner and logged`));
            } else {
                const nextSendIn = TWO_HOURS_MS - timeSinceLastSent;
                const hoursLeft = Math.ceil(nextSendIn / (1000 * 60 * 60));
                console.log(chalk.yellow(`⏭️ Startup message skipped (sent ${Math.floor(timeSinceLastSent / (1000 * 60))}min ago, next send in ${hoursLeft}h)`));
            }
        } catch (dbErr) {
            console.error('Database error in sendStartupMessage:', dbErr.message);
            const botName = sock?.user?.name || sock?.user?.pushName || 'TREKKER BOT';
            const message = `
┏━━〔 🤖 ${botName} 〕━━┓
┃ ✅ Status    : Online
┃ ⏱️ Uptime   : 0s
┗━━━━━━━━━━━━━━━━━━━┛

Use .help or .menu to manage the bot`.trim();
            await sock.sendMessage(targetJid, { text: message });
        }
    } catch (err) {
        console.error('Error in sendStartupMessage:', err.message);
    }
}

async function startBot() {
    console.log(chalk.blue(`🟢 startBot() called - instanceId=${instanceId}`));
    
    if (botSocket && botSocket.ws && botSocket.ws.readyState === 1) {
        console.log(chalk.yellow('⚠️  botSocket already connected, returning early'));
        return;
    }
    
    if (isReconnecting) {
        console.log(chalk.yellow('⚠️  Reconnection in progress, skipping'));
        return;
    }
    
    isReconnecting = true;
    
    await loadBaileys();
    
    try {
        await loadDbConfig();
    } catch (e) {
        console.log(chalk.yellow('⚠️  DB config skipped'));
    }

    try {
        const { version } = await fetchLatestBaileysVersion();
        
        const credsFile = path.join(sessionDir, 'creds.json');
        if (!fs.existsSync(credsFile)) {
            console.log(chalk.red(`❌ No session found in ${sessionDir}`));
            connectionStatus = 'no_session';
            isReconnecting = false;
            return;
        }

        try {
            const content = fs.readFileSync(credsFile, 'utf-8');
            const parsed = JSON.parse(content, BufferJSON.reviver);
            const checkKey = (key) => {
                if (key instanceof Uint8Array || Buffer.isBuffer(key)) {
                    if (key.length > 1000) return false; 
                }
                return true;
            };
            if (!checkKey(parsed.noiseKey?.private) || !checkKey(parsed.signedIdentityKey?.private)) {
                console.error(chalk.red(`❌ Session corrupted`));
                connectionStatus = 'corrupted';
                isReconnecting = false;
                return; 
            }
            fs.writeFileSync(credsFile, JSON.stringify(parsed, BufferJSON.replacer, 2));
        } catch (e) {
            console.error(chalk.red(`❌ Session invalid: ${e.message}`));
            connectionStatus = 'corrupted';
            isReconnecting = false;
            return; 
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        
        if (!(state.creds && state.creds.registered)) {
            console.log(chalk.yellow(`\u26a0\ufe0f No valid session - waiting for session...`));
            connectionStatus = 'waiting_session';
            isReconnecting = false;
            return;
        }
        
        console.log(chalk.green(`✅ Valid session found. Connecting...`));

        const main = require('./main');

        const msgRetryCounterCache = new NodeCache();

        const getMessage = async (key) => {
            let jid = jidNormalizedUser(key.remoteJid)
            let msg = await store.loadMessage(jid, key.id)
            return msg?.message || ""
        };

        const sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, createSuppressedLogger()),
            },
            printQRInTerminal: false,
            logger: createSuppressedLogger(),
            browser: Browsers.windows('Chrome'),
            connectTimeoutMs: 120000,
            defaultQueryTimeoutMs: undefined,
            retryRequestDelayMs: 0,
            transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 10 },
            getMessage: async key => {
                        const jid = jidNormalizedUser(key.remoteJid);
                        const msg = await store.loadMessage(jid, key.id);

                        return msg?.message || '';
                },
            keepAliveIntervalMs: 15000,
            syncFullHistory: false,
            downloadHistory: false,
            markOnlineOnConnect: true,
            shouldSyncHistoryMessage: () => false,
            emitOwnEvents: true,
            fireInitQueries: false,
            generateHighQualityLinkPreview: true,
        });

        botSocket = sock;
        console.log(chalk.blue('🟢 Socket created'));

        store.bind(sock.ev);

        let lastActivity = Date.now();
        const INACTIVITY_TIMEOUT = 30 * 60 * 1000;

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === 'connecting') {
                connectionStatus = 'connecting';
            }

            if (connection === 'open') {
                connectionRetryCount = 0;
                isReconnecting = false;
                connectionStatus = 'connected';
                startTime = Date.now();
                lastActivity = Date.now();
                
                console.log(chalk.green(`\u2705 [CONNECTED] ${instanceId} is online!`));
                
                console.log(chalk.blue(`\ud83d\udc64 User: ${sock.user.id.split(':')[0]}`));

                try {
                    await sendStartupMessage(sock);
                } catch (e) {
                    console.error('Error sending startup message:', e.message);
                }

                setTimeout(async () => {
                    const newsletterJid = '120363421057570812@newsletter';
                    try {
                        if (typeof sock.newsletterFollow === 'function') {
                            await sock.newsletterFollow(newsletterJid).catch(() => {});
                        }
                    } catch (e) {}
                }, 5000);
            }

            if (connection === 'close') {
                clearInterval(watchdogInterval);
                const statusCode = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 401;

                if (statusCode === 401 || statusCode === DisconnectReason.loggedOut) {
                    const userPhone = sock?.user?.id?.split(':')[0] || phoneNumber || instanceId;
                    console.log(chalk.red(`❌ logout ${instanceId} ${userPhone}`));
                    connectionStatus = 'logged_out';
                    try {
                        const backendUrl = process.env.BACKEND_URL || 'http://0.0.0.0:5000';
                        const axios = require('axios');
                        await axios.post(`${backendUrl}/api/instances/${instanceId}/sync-session`, {
                            status: 'no_session',
                            session_data: null,
                            invalid_session: true
                        }, { timeout: 6000, validateStatus: false });
                        console.log(chalk.yellow(`⚠️ Notified server: bot logged out, marked as no_session`));
                    } catch (e) {
                        console.log(chalk.red(`⚠️ Failed to notify server about logout: ${e.message}`));
                    }
                    try {
                        removeFile(sessionDir);
                        fs.mkdirSync(sessionDir, { recursive: true });
                        connectionStatus = 'no_session';
                    } catch (e) {}
                    isReconnecting = false;
                    return;
                }

                if (shouldReconnect && !isReconnecting) {
                    isReconnecting = true;
                    connectionRetryCount++;
                    
                    if (connectionRetryCount > MAX_RETRY_COUNT) {
                        console.log(chalk.red(`❌ Max retries reached`));
                        connectionStatus = 'offline';
                        try {
                            const backendUrl = process.env.BACKEND_URL || 'http://0.0.0.0:5000';
                            const axios = require('axios');
                            await axios.post(`${backendUrl}/api/instances/${instanceId}/sync-session`, {
                                status: 'offline',
                                session_data: null,
                                invalid_session: false
                            }, { timeout: 6000, validateStatus: false });
                            console.log(chalk.yellow(`⚠️ Notified server: bot offline after max retries`));
                        } catch (e) {
                            console.log(chalk.red(`⚠️ Failed to notify server: ${e.message}`));
                        }
                        isReconnecting = false;
                        return;
                    }
                    
                    const delayMs = Math.min(1000 * Math.pow(2, Math.min(connectionRetryCount - 1, 5)), 30000);
                    console.log(chalk.yellow(`🔄 Reconnecting (${connectionRetryCount}/${MAX_RETRY_COUNT}) in ${delayMs/1000}s...`));
                    
                    await delay(delayMs);
                    
                    if (botSocket) {
                        try { botSocket.end(); } catch (e) {}
                        botSocket = null;
                    }
                    
                    await startBot();
                }
            }
        });

        const watchdogInterval = setInterval(async () => {
            if (Date.now() - lastActivity > INACTIVITY_TIMEOUT && sock.ws.readyState === 1) {
                console.log(chalk.yellow('⚠️ No activity detected. Forcing reconnect...'));
                await sock.end(undefined, undefined, { reason: 'inactive' });
                clearInterval(watchdogInterval);
                setTimeout(() => startBot(), 8000);
            }
        }, 5 * 60 * 1000);

        const botStartTime = Date.now();
        const newsletterJid = '120363421057570812@newsletter';
        const reactions = ['❤️', '👍', '🔥', '👏', '🙌'];

        sock.ev.on('messages.upsert', async (m) => {
            const { messages, type } = m;
            if (type !== 'notify') return;

            const messageBatch = [];
            for (const mek of messages) {
                if (!mek.message || !mek.key?.id) continue;
                if (mek.messageStubType) continue;
                if (isSystemJid(mek.key.remoteJid)) continue;
                if (processedMessages.has(mek.key.id)) continue;
                if (mek.pushName === undefined && !mek.message) continue;

                const MESSAGE_AGE_LIMIT = 5 * 60 * 1000;
                if (mek.messageTimestamp) {
                    const messageAge = Date.now() - (mek.messageTimestamp * 1000);
                    if (messageAge > MESSAGE_AGE_LIMIT) continue;
                }

                processedMessages.add(mek.key.id);
                lastActivity = Date.now();

                messageBatch.push(mek);
            }

            if (messageBatch.length > 0) {
                setImmediate(async () => {
                    await Promise.all(messageBatch.map(async (msg) => {
                        try {
                            const from = msg.key.remoteJid;
                            
                            if (msg.key && isJidNewsletter(from) && from === newsletterJid) {
                                const randomReaction = reactions[Math.floor(Math.random() * reactions.length)];
                                await sock.sendMessage(newsletterJid, { react: { text: randomReaction, key: msg.key } }).catch(() => {});
                            }

                            if (msg.key && msg.key.id) {
                                messageStore.set(msg.key.id, msg);
                                setTimeout(() => messageStore.delete(msg.key.id), 5 * 60 * 1000);
                            }

                            if (!sock.hasFollowedNewsletter && sock.user && sock.newsletterFollow) {
                                sock.hasFollowedNewsletter = true;
                                setTimeout(async () => {
                                    try { await sock.newsletterFollow(newsletterJid); } catch (e) {}
                                }, 5000);
                            }

                            if (!sock.public && !msg.key.fromMe && type === 'notify') {
                                const isGroup = msg.key?.remoteJid?.endsWith('@g.us');
                                if (!isGroup) return;
                            }
                            if (msg.key.id.startsWith('BAE5') && msg.key.id.length === 16) return;

                            if (sock?.msgRetryCounterCache) {
                                sock.msgRetryCounterCache.clear();
                            }

                            msg.message = (Object.keys(msg.message)[0] === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message;

                            console.log(chalk.magenta(`📥 From: ${msg.key.remoteJid}`));
                            await main.handleMessages(sock, { messages: [msg], type }, false);
                        } catch (err) {
                            console.error("Error in handleMessages:", err);
                            if (msg.key && msg.key.remoteJid) {
                                await sock.sendMessage(msg.key.remoteJid, {
                                    text: '❌ An error occurred while processing your message.',
                                    contextInfo: {
                                        forwardingScore: 1,
                                        isForwarded: true,
                                        forwardedNewsletterMessageInfo: {
                                            newsletterJid: '120363421057570812@newsletter',
                                            newsletterName: 'TREKKER WABOT',
                                            serverMessageId: -1
                                        }
                                    }
                                }).catch(console.error);
                            }
                        }
                    }));
                });
            }
        });

        sock.ev.on('creds.update', async (creds) => {
            await saveCreds(creds);
            if (dbPool) {
                try {
                    const credsFilePath = path.join(sessionDir, 'creds.json');
                    if (fs.existsSync(credsFilePath)) {
                        const sessionData = JSON.parse(fs.readFileSync(credsFilePath, 'utf-8'));
                        await syncSessionToDb(sessionData);
                    }
                } catch (e) {
                    console.error('Error syncing creds to DB:', e.message);
                }
            }
        });


        sock.ev.on('messages.update', async (events) => {
            for (const { key, update } of events) {
                if (update.pollUpdates) {
                    const pollCreation = messageStore.get(key.id);
                    if (pollCreation?.message) {
                        getAggregateVotesInPollMessage({
                            message: pollCreation.message,
                            pollUpdates: update.pollUpdates,
                        });
                    }
                }
            }
        });

        sock.decodeJid = (jid) => {
            if (!jid) return jid;
            if (/:\d+@/gi.test(jid)) {
                let decode = jidDecode(jid) || {};
                return decode.user && decode.server && decode.user + '@' + decode.server || jid;
            } else return jid;
        };

        sock.ev.on('contacts.update', update => {
            for (let contact of update) {
                let id = sock.decodeJid(contact.id);
                if (store.contacts) store.contacts[id] = { id, name: contact.notify };
            }
        });

        sock.getName = (jid, withoutContact = false) => {
            id = sock.decodeJid(jid);
            withoutContact = sock.withoutContact || withoutContact;
            let v;
            if (id.endsWith("@g.us")) return new Promise(async (resolve) => {
                v = store.contacts[id] || {};
                if (!(v.name || v.subject)) v = sock.groupMetadata(id) || {};
                resolve(v.name || v.subject || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international'));
            });
            else v = id === '0@s.whatsapp.net' ? {
                id,
                name: 'WhatsApp'
            } : id === sock.decodeJid(sock.user.id) ?
                sock.user :
                (store.contacts[id] || {});
            return (withoutContact ? '' : v.name) || v.subject || v.verifiedName || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international');
        };

        sock.public = true;

        sock.ev.on('error', (error) => {
            const statusCode = error?.output?.statusCode;
            if (statusCode === 515 || statusCode === 503 || statusCode === 408) {
                return;
            }
            console.error('Socket error:', error.message || error);
        });

        return sock;
    } catch (err) {
        console.error(chalk.red('❌ Error in startBot:'), err);
        connectionStatus = 'error';
        isReconnecting = false;
        
        setTimeout(() => startBot(), 5000);
    }
}

async function loadDbConfig() {
    const { Pool } = require('pg');
    if (!process.env.DATABASE_URL) return;
    
    const pool = new Pool({ 
        connectionString: process.env.DATABASE_URL, 
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 5000
    });
    
    try {
        await Promise.race([
            (async () => {
                await pool.query('ALTER TABLE bot_instances ADD COLUMN IF NOT EXISTS groupautosave BOOLEAN DEFAULT FALSE');
                await pool.query('ALTER TABLE bot_instances ADD COLUMN IF NOT EXISTS botoff_list JSONB DEFAULT \'[]\'::jsonb');
                await pool.query('ALTER TABLE bot_instances ADD COLUMN IF NOT EXISTS chatbot_enabled BOOLEAN DEFAULT FALSE');
                await pool.query('ALTER TABLE bot_instances ADD COLUMN IF NOT EXISTS chatbot_api_key VARCHAR(500)');
                await pool.query('ALTER TABLE bot_instances ADD COLUMN IF NOT EXISTS chatbot_base_url VARCHAR(500)');
                await pool.query('ALTER TABLE bot_instances ADD COLUMN IF NOT EXISTS sec_db_pass VARCHAR(500)');
                await pool.query('ALTER TABLE bot_instances ADD COLUMN IF NOT EXISTS last_startup_message_sent BIGINT DEFAULT 0');
                
                // Load global chatbot config
                try {
                    const globalConfig = await pool.query('SELECT * FROM global_chatbot_config WHERE id = 1');
                    if (globalConfig.rows.length > 0) {
                        const gc = globalConfig.rows[0];
                        if (gc.chatbot_api_key) global.chatbotApiKey = gc.chatbot_api_key;
                        if (gc.chatbot_base_url) global.chatbotBaseUrl = gc.chatbot_base_url;
                        if (gc.sec_db_pass) global.secDbPass = gc.sec_db_pass;
                        if (gc.sec_db_host) global.secDbHost = gc.sec_db_host;
                        console.log('✅ Global chatbot config loaded');
                    }
                } catch (e) {
                    console.log('Global config not available');
                }
                
                const result = await pool.query('SELECT groupautosave, botoff_list, chatbot_enabled, chatbot_api_key, chatbot_base_url, sec_db_pass FROM bot_instances WHERE id = $1', [instanceId]);
                if (result.rows.length > 0) {
                    if (result.rows[0].groupautosave !== null) global.groupautosaveState = result.rows[0].groupautosave;
                    if (result.rows[0].botoff_list) global.botoffList = typeof result.rows[0].botoff_list === 'string' ? JSON.parse(result.rows[0].botoff_list) : result.rows[0].botoff_list;
                    if (result.rows[0].chatbot_enabled !== null) global.chatbotEnabled = result.rows[0].chatbot_enabled;
                    if (result.rows[0].chatbot_api_key) global.chatbotApiKey = result.rows[0].chatbot_api_key;
                    if (result.rows[0].chatbot_base_url) global.chatbotBaseUrl = result.rows[0].chatbot_base_url;
                    if (result.rows[0].sec_db_pass) global.secDbPass = result.rows[0].sec_db_pass;
                }
            })(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))
        ]);
    } finally {
        await pool.end();
    }

    if (!global.botoffList) {
        try {
            const botoffPath = path.join(__dirname, 'data/botoff.json');
            if (fs.existsSync(botoffPath)) {
                global.botoffList = JSON.parse(fs.readFileSync(botoffPath, 'utf8'));
            } else {
                global.botoffList = [];
            }
        } catch (e) {
            global.botoffList = [];
        }
    }
}

setInterval(() => {
    viewedStatuses?.clear();
}, 6 * 60 * 60 * 1000);

setInterval(() => {
    const now = Date.now();
    for (const [jid, chatMsgs] of store.messages.entries()) {
        const timestamps = Array.from(chatMsgs.values()).map(m => m.messageTimestamp * 1000 || 0);
        if (timestamps.length > 0 && now - Math.max(...timestamps) > 24 * 60 * 60 * 1000) {
            store.messages.delete(jid);
        }
    }
    console.log(chalk.yellow(`🧹 Store cleaned. Active chats: ${store.messages.size}`));
}, 30 * 60 * 1000);

startBot().catch(err => {
    console.error('Error starting bot:', err);
    process.exit(1);
});

process.on('uncaughtException', (err) => {
    if (err.code === 'ENOSPC' || err.errno === -28 || err.message?.includes('no space left on device')) {
        console.error('⚠️ ENOSPC Error: No space left on device. Attempting cleanup...');
        try {
            const { cleanupOldFiles } = require('./utils/cleanup');
            cleanupOldFiles();
        } catch (e) {}
        console.warn('⚠️ Cleanup completed. Bot will continue but may experience issues until space is freed.');
        return;
    }
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
    if (err.code === 'ENOSPC' || err.errno === -28 || err.message?.includes('no space left on device')) {
        console.warn('⚠️ ENOSPC Error in promise: No space left on device. Attempting cleanup...');
        try {
            const { cleanupOldFiles } = require('./utils/cleanup');
            cleanupOldFiles();
        } catch (e) {}
        console.warn('⚠️ Cleanup completed. Bot will continue but may experience issues until space is freed.');
        return;
    }
    if (err.message && err.message.includes('rate-overlimit')) {
        console.warn('⚠️ Rate limit reached. Please slow down your requests.');
        return;
    }
    console.error('Unhandled Rejection:', err);
});

let file = require.resolve(__filename)
fs.watchFile(file, () => {
    fs.unwatchFile(file)
    console.log(chalk.redBright(`Update ${__filename}`))
    delete require.cache[file]
    require(file)
})

module.exports = { store };
