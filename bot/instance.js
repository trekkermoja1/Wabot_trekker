if (!globalThis.crypto) {
    globalThis.crypto = require('crypto').webcrypto;
}
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const os = require('os');
const chalk = require('chalk');

let makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, proto, makeCacheableSignalKeyStore, delay, Browsers, BufferJSON, isJidNewsletter, getAggregateVotesInPollMessage, jidNormalizedUser, jidDecode;
let PhoneNumber;

const store = {
  messages: new Map(),
  maxPerChat: 20,
  contacts: new Map(),

  bind: (ev) => {
    ev.on('messages.upsert', ({ messages }) => {
      for (const msg of messages) {
        if (!msg.key?.id) continue;

        const jid = msg.key.remoteJid;
        if (!store.messages.has(jid)) {
          store.messages.set(jid, new Map());
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
const apiPort = parseInt(args[2]) || 3001;

global.instanceId = instanceId;
global.chatbotEnabled = false;

const instanceDir = path.join(__dirname, 'instances', instanceId);
const sessionDir = path.join(instanceDir, 'session');
const dataDir = path.join(instanceDir, 'data');

let connectionStatus = 'initializing';
let botSocket = null;
let startTime = Date.now();
let lastStatusSync = 0;
const SYNC_INTERVAL = 60 * 60 * 1000;
let connectionRetryCount = 0;
const MAX_RETRY_COUNT = 15;
let isReconnecting = false;
let viewedStatuses = new Set();
let lastMessageReceived = Date.now();
let healthCheckInterval = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 50;
const BASE_RECONNECT_DELAY = 5000;

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
        'status@broadcast',
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
            console.log(chalk.yellow(`⚠️ No valid session - waiting for session...`));
            connectionStatus = 'waiting_session';
            isReconnecting = false;
            
            // Notify server about invalid session to prevent infinite restart loop
            try {
                const backendUrl = process.env.BACKEND_URL || 'http://0.0.0.0:5000';
                const axios = require('axios');
                await axios.post(`${backendUrl}/api/instances/${instanceId}/sync-session`, {
                    status: 'no_session',
                    invalid_session: true
                }, { timeout: 6000, validateStatus: false });
            } catch (e) {}

            return;
        }
        
        console.log(chalk.green(`✅ Valid session found. Connecting...`));

        // Preload all handlers BEFORE socket connection
        console.log(chalk.blue('📦 Preloading handlers...'));
        
        try {
            require('./main');
            console.log(chalk.green('✅ Main handler loaded'));
            
            require('./commands/autostatus');
            console.log(chalk.green('✅ Status handler loaded'));
            
            require('./commands/antidelete');
            console.log(chalk.green('✅ Antidelete handler loaded'));
            
            require('./commands/autotyping');
            console.log(chalk.green('✅ Autotyping handler loaded'));
            
            require('./commands/autoread');
            console.log(chalk.green('✅ Autoread handler loaded'));
            
            require('./commands/welcome');
            console.log(chalk.green('✅ Welcome handler loaded'));
            
            require('./commands/goodbye');
            console.log(chalk.green('✅ Goodbye handler loaded'));
            
            require('./lib/antibadword');
            console.log(chalk.green('✅ Antibadword handler loaded'));
            
            require('./lib/antilink');
            console.log(chalk.green('✅ Antilink handler loaded'));
            
            require('./commands/chatbotdb');
            console.log(chalk.green('✅ Chatbot handler loaded'));
            
            require('./commands/hangman');
            console.log(chalk.green('✅ Hangman handler loaded'));
            
            require('./commands/trivia');
            console.log(chalk.green('✅ Trivia handler loaded'));
            
            require('./commands/tictactoe');
            console.log(chalk.green('✅ TicTacToe handler loaded'));
            
            require('./commands/mention');
            console.log(chalk.green('✅ Mention handler loaded'));
            
            require('./commands/antitag');
            console.log(chalk.green('✅ Antitag handler loaded'));
            
            require('./commands/topmembers');
            console.log(chalk.green('✅ Topmembers handler loaded'));
            
            require('./commands/fun/reactions');
            console.log(chalk.green('✅ Fun reactions handler loaded'));
            
            require('./commands/promote');
            console.log(chalk.green('✅ Promote handler loaded'));
            
            require('./commands/demote');
            console.log(chalk.green('✅ Demote handler loaded'));
            
            console.log(chalk.green('✅ All handlers preloaded and ready!'));
        } catch (e) {
            console.error(chalk.red('⚠️ Error preloading handlers:'), e.message);
        }

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
            defaultQueryTimeoutMs: 120000,
            keepAliveIntervalMs: 30000, // Increased keep-alive for more stable connection
            syncFullHistory: false,
            downloadHistory: false,
            markOnlineOnConnect: true,
            // Add reconnection options
            retryRequestTimeoutMs: 30000,
            maxCachedMessages: 100,
            // Improved connection handling
            handshakingTimeoutMs: 60000,
            // Ignore certain JIDs properly
            shouldIgnoreJid: (jid, message) => {
                if (jid === 'status@broadcast') {
                    const msgType = Object.keys(message?.message || {})[0];
                    if (msgType === 'protocolMessage' && message.message.protocolMessage?.type === 'append') {
                        return jid;
                    }
                }
                return undefined;
            },
            getMessage: async (key) => {
                return store.messages.get(key?.remoteJid)?.get(key?.id) || undefined;
            },
            emitOwnEvents: true,
            fireInitQueries: true,
            generateHighQualityLinkPreview: true,
        });

        botSocket = sock;
        console.log(chalk.blue('🟢 Socket created'));

        store.bind(sock.ev);

        let lastActivity = Date.now();
        const INACTIVITY_TIMEOUT = 30 * 60 * 1000;

        // Health check mechanism to ensure bot stays alive independently
        healthCheckInterval = setInterval(async () => {
            if (!sock || !sock.ws) {
                console.log(chalk.yellow('⚠️ Health check: Socket undefined, restarting...'));
                clearInterval(healthCheckInterval);
                setTimeout(() => startBot(), 5000);
                return;
            }

            // Check WebSocket connection state
            const wsReady = sock.ws.readyState;
            if (wsReady !== 1) {
                console.log(chalk.yellow(`⚠️ Health check: WebSocket not open (state: ${wsReady}), reconnecting...`));
                clearInterval(healthCheckInterval);
                try { sock.end(); } catch (e) {}
                botSocket = null;
                setTimeout(() => startBot(), 5000);
                return;
            }

            // Check if we're receiving messages (activity check)
            const timeSinceLastMsg = Date.now() - lastMessageReceived;
            if (timeSinceLastMsg > 15 * 60 * 1000) {
                console.log(chalk.yellow(`⚠️ Health check: No messages for ${Math.floor(timeSinceLastMsg/60000)}min, checking connection...`));
                
                // Try to send a ping to verify connection
                try {
                    if (sock.user && sock.user.id) {
                        await sock.sendPresenceUpdate('available', sock.user.id).catch(() => {});
                    }
                } catch (e) {
                    console.log(chalk.yellow('⚠️ Health check: Failed to send presence, reconnecting...'));
                    clearInterval(healthCheckInterval);
                    try { sock.end(); } catch (err) {}
                    botSocket = null;
                    setTimeout(() => startBot(), 5000);
                    return;
                }
            }

            // Verify connection is still functional
            try {
                if (sock.user && sock.user.id) {
                    await sock.fetchPrivacySettings({ token: 'last' }).catch(() => {});
                }
            } catch (e) {
                console.log(chalk.yellow('⚠️ Health check: Connection test failed, restarting...'));
                clearInterval(healthCheckInterval);
                try { sock.end(); } catch (err) {}
                botSocket = null;
                setTimeout(() => startBot(), 5000);
                return;
            }

            console.log(chalk.green(`✅ Health check OK - Connection active, last msg: ${Math.floor((Date.now() - lastMessageReceived)/60000)}min ago`));
        }, 5 * 60 * 1000);

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
                
                console.log(chalk.green(`✅ [CONNECTED] ${instanceId} is online!`));
                
                await syncSessionToDb(true);
                
                console.log(chalk.blue(`👤 User: ${sock.user.id.split(':')[0]}`));

                try {
                    const devSuffix = process.env.DEV_MODE === 'true' ? ' [DEV MODE]' : '';
                    await sock.sendMessage(sock.user.id, { text: `TREKKER wabot is active${devSuffix}` });
                } catch (e) {
                    console.error('Error sending online message:', e.message);
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
                clearInterval(healthCheckInterval);
                const statusCode = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 401;

                if (statusCode === 401 || statusCode === DisconnectReason.loggedOut) {
                    console.log(chalk.red(`❌ Session logged out`));
                    connectionStatus = 'logged_out';
                    try {
                        removeFile(sessionDir);
                        fs.mkdirSync(sessionDir, { recursive: true });
                        connectionStatus = 'no_session';
                    } catch (e) {}
                    isReconnecting = false;
                    return;
                }

                if (shouldReconnect || !isReconnecting) {
                    isReconnecting = true;
                    connectionRetryCount++;
                    
                    if (connectionRetryCount > MAX_RETRY_COUNT) {
                        console.log(chalk.red(`❌ Max retries reached, attempting aggressive reconnection...`));
                    }
                    
                    const delayMs = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, Math.min(connectionRetryCount - 1, 8)), 60000);
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

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;

            for (const msg of messages) {
                if (!msg.message || !msg.key?.id) continue;

                const from = msg.key.remoteJid;
                if (!from) continue;

                if (isSystemJid(from)) continue;

                const msgId = msg.key.id;
                if (processedMessages.has(msgId)) continue;

                const MESSAGE_AGE_LIMIT = 5 * 60 * 1000;
                if (msg.messageTimestamp) {
                    const messageAge = Date.now() - (msg.messageTimestamp * 1000);
                    if (messageAge > MESSAGE_AGE_LIMIT) continue;
                }

                processedMessages.add(msgId);
                lastActivity = Date.now();
                lastMessageReceived = Date.now(); // Update health check timestamp

                if (msg.key && msg.key.id) {
                    if (!store.messages.has(from)) {
                        store.messages.set(from, new Map());
                    }
                    const chatMsgs = store.messages.get(from);
                    chatMsgs.set(msg.key.id, msg);

                    if (chatMsgs.size > store.maxPerChat) {
                        const sortedIds = Array.from(chatMsgs.entries())
                            .sort((a, b) => (a[1].messageTimestamp || 0) - (b[1].messageTimestamp || 0))
                            .map(([id]) => id);
                        for (let i = 0; i < sortedIds.length - store.maxPerChat; i++) {
                            chatMsgs.delete(sortedIds[i]);
                        }
                    }
                }

                if (from === 'status@broadcast' && !viewedStatuses.has(msg.key.id) && (msg.messageTimestamp?.low || msg.messageTimestamp || 0) * 1000 >= botStartTime) {
                    viewedStatuses.add(msg.key.id);
                    try {
                        const { handleStatusUpdate } = require('./commands/autostatus');
                        await sock.readMessages([msg.key]);
                        await handleStatusUpdate(sock, msg);
                    } catch (e) {}
                }

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
                    if (!isGroup) continue;
                }
                if (msg.key.id.startsWith('BAE5') && msg.key.id.length === 16) continue;

                if (sock?.msgRetryCounterCache) {
                    sock.msgRetryCounterCache.clear();
                }

                msg.message = (Object.keys(msg.message)[0] === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message;

                try {
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
            }
        });

        sock.ev.on('creds.update', async () => {
            await saveCreds();
            await syncSessionToDb();
        });

        const syncSessionToDb = async (force = false) => {
            const now = Date.now();
            if (!force && lastStatusSync !== 0 && (now - lastStatusSync < SYNC_INTERVAL)) return;

            try {
                const backendUrl = process.env.BACKEND_URL || 'http://0.0.0.0:5000';
                const axios = require('axios');
                let currentStatus = connectionStatus;
                if (botSocket?.user) currentStatus = 'connected';
                
                const invalidSessionStatuses = ['no_session', 'corrupted', 'logged_out'];
                const isInvalidSession = invalidSessionStatuses.includes(currentStatus);
                
                await axios.post(`${backendUrl}/api/instances/${instanceId}/sync-session`, {
                    status: currentStatus,
                    session_data: (currentStatus === 'connected' || currentStatus === 'connecting') ? JSON.stringify(state.creds, BufferJSON.replacer) : null,
                    invalid_session: isInvalidSession
                }, { timeout: 6000, validateStatus: false });
                
                lastStatusSync = now;
                
                if (isInvalidSession) {
                    console.log(chalk.yellow(`⚠️ Invalid session detected: ${currentStatus}, notified server to mark offline`));
                }
            } catch (e) {}
        };

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
        
        // Aggressive auto-restart on error
        reconnectAttempts++;
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            const restartDelay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, Math.min(reconnectAttempts, 8)), 60000);
            console.log(chalk.yellow(`🔄 Auto-restarting bot (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) in ${restartDelay/1000}s...`));
            clearInterval(healthCheckInterval);
            setTimeout(() => startBot(), restartDelay);
        } else {
            console.log(chalk.red(`❌ Max auto-restart attempts reached, stopping...`));
            process.exit(1);
        }
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
                await pool.query('ALTER TABLE bot_instances ADD COLUMN IF NOT EXISTS autoview BOOLEAN DEFAULT TRUE');
                await pool.query('ALTER TABLE bot_instances ADD COLUMN IF NOT EXISTS botoff_list JSONB DEFAULT \'[]\'::jsonb');
                await pool.query('ALTER TABLE bot_instances ADD COLUMN IF NOT EXISTS chatbot_enabled BOOLEAN DEFAULT FALSE');
                await pool.query('ALTER TABLE bot_instances ADD COLUMN IF NOT EXISTS chatbot_api_key VARCHAR(500)');
                await pool.query('ALTER TABLE bot_instances ADD COLUMN IF NOT EXISTS chatbot_base_url VARCHAR(500)');
                await pool.query('ALTER TABLE bot_instances ADD COLUMN IF NOT EXISTS sec_db_pass VARCHAR(500)');
                
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
                
                const result = await pool.query('SELECT autoview, botoff_list, chatbot_enabled, chatbot_api_key, chatbot_base_url, sec_db_pass FROM bot_instances WHERE id = $1', [instanceId]);
                if (result.rows.length > 0) {
                    if (result.rows[0].autoview !== null) global.autoviewState = result.rows[0].autoview;
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
    console.log(chalk.yellow('🔄 Retrying bot start after error...'));
    setTimeout(() => {
        startBot().catch(e => {
            console.error('Retry failed:', e);
            process.exit(1);
        });
    }, 10000);
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
    console.log(chalk.yellow('🔄 Restarting bot due to uncaught exception...'));
    setTimeout(() => {
        botSocket = null;
        isReconnecting = false;
        connectionRetryCount = 0;
        startBot().catch(e => console.error('Failed to restart:', e));
    }, 5000);
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
    console.log(chalk.yellow('🔄 Restarting bot due to unhandled rejection...'));
    setTimeout(() => {
        botSocket = null;
        isReconnecting = false;
        connectionRetryCount = 0;
        startBot().catch(e => console.error('Failed to restart:', e));
    }, 5000);
});

let file = require.resolve(__filename)
fs.watchFile(file, () => {
    fs.unwatchFile(file)
    console.log(chalk.redBright(`Update ${__filename}`))
    delete require.cache[file]
    require(file)
})

module.exports = { store };
