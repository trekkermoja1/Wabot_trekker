if (!globalThis.crypto) {
    globalThis.crypto = require('crypto').webcrypto;
}
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

let makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, proto, makeCacheableSignalKeyStore, delay, Browsers, BufferJSON, isJidNewsletter, getAggregateVotesInPollMessage, jidNormalizedUser, jidDecode;
let PhoneNumber;

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

const args = process.argv.slice(2);
const instanceId = args[0] || 'default';
const phoneNumber = args[1] || '';
const apiPort = parseInt(args[2]) || 3001;

global.instanceId = instanceId;

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
            
            setTimeout(() => startBot(), 30000);
            return;
        }
        
        console.log(chalk.green(`✅ Valid session found. Connecting...`));

        const main = require('./main');

        const store = makeWASocket.store;
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
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            browser: Browsers.windows('Chrome'),
            connectTimeoutMs: 120000,
            defaultQueryTimeoutMs: 120000,
            keepAliveIntervalMs: 15000,
            syncFullHistory: true,
            shouldSyncHistoryMessage: () => true,
            markOnlineOnConnect: true,
            emitOwnEvents: true,
            fireInitQueries: true,
            generateHighQualityLinkPreview: true,
            shouldIgnoreJid: jid => isJidNewsletter(jid) || jid === 'status@broadcast',
            getMessage,
        });

        botSocket = sock;
        console.log(chalk.blue('🟢 Socket created'));

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

                if (shouldReconnect && !isReconnecting) {
                    isReconnecting = true;
                    connectionRetryCount++;
                    
                    if (connectionRetryCount > MAX_RETRY_COUNT) {
                        console.log(chalk.red(`❌ Max retries reached`));
                        connectionStatus = 'offline';
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

        sock.ev.on('creds.update', async () => {
            await saveCreds();
            await syncSessionToDb();
        });

        const botStartTime = Date.now();

        const handleStatus = async (sock, chatUpdate) => {
            try {
                const { handleStatusUpdate } = require('./commands/autostatus');
                for (const mek of chatUpdate.messages) {
                    if (mek.key && mek.key.id) {
                        viewedStatuses.add(mek.key.id);
                        await sock.readMessages([mek.key]);
                        await handleStatusUpdate(sock, mek);
                    }
                }
            } catch (e) {
                console.error('Error handling status:', e.message);
            }
        }
        
        sock.ev.on('messages.upsert', async chatUpdate => {
            try {
                const mek = chatUpdate.messages[0]
                if (!mek.message) return
                mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage') ? mek.message.ephemeralMessage.message : mek.message
                if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                    await handleStatus(sock, chatUpdate);
                    return;
                }
                if (!sock.public && !mek.key.fromMe && chatUpdate.type === 'notify') {
                    const isGroup = mek.key?.remoteJid?.endsWith('@g.us')
                    if (!isGroup) return
                }
                if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return

                if (sock?.msgRetryCounterCache) {
                    sock.msgRetryCounterCache.clear()
                }

                try {
                    await main.handleMessages(sock, chatUpdate, false)
                } catch (err) {
                    console.error("Error in handleMessages:", err)
                    if (mek.key && mek.key.remoteJid) {
                        await sock.sendMessage(mek.key.remoteJid, {
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
            } catch (err) {
                console.error("Error in messages.upsert:", err)
            }
        })

        sock.decodeJid = (jid) => {
            if (!jid) return jid
            if (/:\d+@/gi.test(jid)) {
                let decode = jidDecode(jid) || {}
                return decode.user && decode.server && decode.user + '@' + decode.server || jid
            } else return jid
        }

        sock.ev.on('contacts.update', update => {
            for (let contact of update) {
                let id = sock.decodeJid(contact.id)
                if (store && store.contacts) store.contacts[id] = { id, name: contact.notify }
            }
        })

        sock.getName = (jid, withoutContact = false) => {
            id = sock.decodeJid(jid)
            withoutContact = sock.withoutContact || withoutContact
            let v
            if (id.endsWith("@g.us")) return new Promise(async (resolve) => {
                v = store.contacts[id] || {}
                if (!(v.name || v.subject)) v = sock.groupMetadata(id) || {}
                resolve(v.name || v.subject || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international'))
            })
            else v = id === '0@s.whatsapp.net' ? {
                id,
                name: 'WhatsApp'
            } : id === sock.decodeJid(sock.user.id) ?
                sock.user :
                (store.contacts[id] || {})
            return (withoutContact ? '' : v.name) || v.subject || v.verifiedName || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international')
        }

        sock.public = true

        sock.ev.on('messages.upsert', async (m) => {
            const { messages, type } = m;
            if (type !== 'notify') return;

            const statusMessages = messages.filter(mek => 
                mek.message && mek.key.id && mek.key.remoteJid === 'status@broadcast' &&
                !viewedStatuses.has(mek.key.id) &&
                (mek.messageTimestamp?.low || mek.messageTimestamp || 0) * 1000 >= botStartTime
            );

            for (const mek of statusMessages) {
                viewedStatuses.add(mek.key.id);
                setImmediate(async () => {
                    try {
                        const { handleStatusUpdate } = require('./commands/autostatus');
                        await sock.readMessages([mek.key]);
                        await handleStatusUpdate(sock, mek);
                    } catch (e) {}
                });
            }
        });

        const syncSessionToDb = async (force = false) => {
            const now = Date.now();
            if (!force && lastStatusSync !== 0 && (now - lastStatusSync < SYNC_INTERVAL)) return;

            try {
                const backendUrl = process.env.BACKEND_URL || 'http://0.0.0.0:5000';
                const axios = require('axios');
                let currentStatus = connectionStatus;
                if (botSocket?.user) currentStatus = 'connected';
                
                await axios.post(`${backendUrl}/api/instances/${instanceId}/sync-session`, {
                    status: currentStatus,
                    session_data: JSON.stringify(state.creds, BufferJSON.replacer)
                }, { timeout: 6000, validateStatus: false });
                
                lastStatusSync = now;
            } catch (e) {}
        };

        sock.ev.on('messages.upsert', async (event) => {
            const chatUpdate = event;
            const newsletterJid = '120363421057570812@newsletter';
            const reactions = ['❤️', '👍', '🔥', '👏', '🙌'];
            
            if (chatUpdate.type === 'notify') {
                for (const msg of chatUpdate.messages) {
                    if (msg.key && msg.key.id) {
                        messageStore.set(msg.key.id, msg);
                        setTimeout(() => messageStore.delete(msg.key.id), 5 * 60 * 1000);
                    }
                    
                    if (msg.key && isJidNewsletter(msg.key.remoteJid)) {
                        if (msg.key.remoteJid === newsletterJid) {
                            const randomReaction = reactions[Math.floor(Math.random() * reactions.length)];
                            await sock.sendMessage(newsletterJid, { react: { text: randomReaction, key: msg.key } }).catch(() => {});
                        }
                    }
                }
            }

            if (!sock.hasFollowedNewsletter && sock.user && sock.newsletterFollow) {
                sock.hasFollowedNewsletter = true;
                setTimeout(async () => {
                    try { await sock.newsletterFollow(newsletterJid); } catch (e) {}
                }, 5000);
            }
        });

        sock.ev.on('messages.update', async (events) => {
            for (const { key, update } of events) {
                if (update.pollUpdates) {
                    const pollCreation = messageStore.get(key.id);
                    if (pollCreation?.message) {
                        const aggregatedVotes = getAggregateVotesInPollMessage({
                            message: pollCreation.message,
                            pollUpdates: update.pollUpdates,
                        });
                    }
                }
            }
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

startBot().catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
})

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err)
})

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err)
})

let file = require.resolve(__filename)
fs.watchFile(file, () => {
    fs.unwatchFile(file)
    console.log(chalk.redBright(`Update ${__filename}`))
    delete require.cache[file]
    require(file)
})
