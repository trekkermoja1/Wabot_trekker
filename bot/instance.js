// Polyfill crypto if needed
if (!globalThis.crypto) {
    globalThis.crypto = require('crypto').webcrypto;
}
require('dotenv').config();
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const pn = require('awesome-phonenumber');
// Import Baileys dynamically as it is an ES Module
let makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, jidDecode, proto, jidNormalizedUser, makeCacheableSignalKeyStore, delay, Browsers, BufferJSON, isJidBroadcast, isJidNewsletter, getAggregateVotesInPollMessage;

async function loadBaileys() {
    const baileys = await import("@whiskeysockets/baileys");
    makeWASocket = baileys.default;
    useMultiFileAuthState = baileys.useMultiFileAuthState;
    DisconnectReason = baileys.DisconnectReason;
    fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
    jidDecode = baileys.jidDecode;
    proto = baileys.proto;
    jidNormalizedUser = baileys.jidNormalizedUser;
    makeCacheableSignalKeyStore = baileys.makeCacheableSignalKeyStore;
    delay = baileys.delay;
    Browsers = baileys.Browsers;
    BufferJSON = baileys.BufferJSON;
    isJidBroadcast = baileys.isJidBroadcast;
    isJidNewsletter = baileys.isJidNewsletter;
    getAggregateVotesInPollMessage = baileys.getAggregateVotesInPollMessage;
}

// External cache to store retry counts of messages when decryption/encryption fails
// Keep this out of the socket itself to prevent a message retry loop across socket restarts
const msgRetryCounterCache = new (require("node-cache"))();

// Message store for getMessage retries (stores recent messages)
const messageStore = new Map();

const NodeCache = require("node-cache");
const pino = require("pino");
const { rmSync, existsSync } = require('fs');
const http = require('http');
const url = require('url');

// Get instance configuration from command line arguments
const args = process.argv.slice(2);
const instanceId = args[0] || 'default';
const phoneNumber = args[1] || '';
const apiPort = parseInt(args[2]) || 3001;

// Instance-specific paths
const instanceDir = path.join(__dirname, 'instances', instanceId);
const sessionDir = path.join(instanceDir, 'session');
const dataDir = path.join(instanceDir, 'data');

// Helper to update DB status
async function updateDbStatus(status) {
    if (!process.env.DATABASE_URL) return;
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    try {
        await pool.query('UPDATE bot_instances SET status = $1, updated_at = NOW() WHERE id = $2', [status, instanceId]);
    } catch (e) {
        console.error('Error updating DB status:', e);
    } finally {
        await pool.end();
    }
}

// Timeout check - ONLY for pairing phase
let pairingTimeout = null;
function startPairingTimeout() {
    if (pairingTimeout) clearTimeout(pairingTimeout);
    pairingTimeout = setTimeout(async () => {
        if (connectionStatus === 'pairing' && !isAuthenticated) {
            console.log(chalk.yellow(`⏳ Pairing timeout reached for ${instanceId}. Clearing pairing code and returning to dormant state.`));
            try { await updateDbStatus('offline'); } catch (e) {}
            pairingCode = null;
            pairingCodeGeneratedAt = null;
            connectionStatus = 'ready_to_pair';
            // Do not exit the process; stay dormant and wait for explicit user action.
        }
    }, 5 * 60 * 1000);
}

// Global state
let pairingCode = null;
let pairingCodeGeneratedAt = null;
let connectionStatus = 'initializing';
let botSocket = null;
let isAuthenticated = false;
let startTime = Date.now();
let lastStatusSync = 0;
const SYNC_INTERVAL = 60 * 60 * 1000; // 1 hour

// Helper function to remove files/directories
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

// Ensure directories exist
function ensureDirectories() {
    if (!fs.existsSync(instanceDir)) fs.mkdirSync(instanceDir, { recursive: true });
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
        // Copy default data files
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

// Clean phone number and validate
function cleanAndValidatePhone(num) {
    // Remove any non-digit characters
    num = num.replace(/[^0-9]/g, '');
    
    // Validate using awesome-phonenumber
    try {
        const phone = pn('+' + num);
        if (!phone.isValid()) {
            // Fallback: accept numeric input if it looks like an international number
            if (num.length >= 7) {
                console.log('⚠️ Phone validation fallback: accepting numeric input as-is');
                return { valid: true, number: num };
            }
            return { valid: false, error: 'Invalid phone number. Please enter your full international number without + or spaces.' };
        }
        // Return E.164 format without +
        return { valid: true, number: phone.getNumber('e164').replace('+', '') };
    } catch (e) {
        // If awesome-phonenumber throws, fallback to numeric acceptance for pairing/testing
        if (num.length >= 7) {
            console.log('⚠️ Phone validation error, falling back to numeric input');
            return { valid: true, number: num };
        }
        return { valid: false, error: 'Invalid phone number. Please enter your full international number without + or spaces.' };
    }
}

console.log(chalk.cyan(`\n🚀 TREKKER MAX WABOT - Instance: ${instanceId}`));
console.log(chalk.cyan(`📱 Phone: ${phoneNumber}`));
console.log(chalk.cyan(`📁 Session Dir: ${sessionDir}`));

// Ensure directories exist
ensureDirectories();

// HTTP Server for API communication
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
            pairingCode: pairingCode || null,
            pairingCodeGeneratedAt,
            phoneNumber,
            isAuthenticated,
            user: botSocket?.user || null,
            apiPort
        }));
        return;
    } else if (pathname === '/pairing-code' || pathname === '/pairing-code/') {
        // Just return current pairing status - do NOT auto-trigger pairing
        // User must call /regenerate-code to start pairing process
        res.writeHead(200);
        res.end(JSON.stringify({
            pairingCode: pairingCode || null,
            pairingCodeGeneratedAt,
            status: connectionStatus,
            isAuthenticated
        }));
    } else if (pathname === '/regenerate-code' || (pathname === '/regenerate-code/' && req.method === 'POST')) {
        console.log(chalk.blue('📱 Regenerate pairing code requested'));
        
        // Always reset everything for a fresh pairing on explicit request
        console.log(chalk.yellow(`🔄 Resetting instance ${instanceId} for fresh pairing...`));
        
        // 1. Close existing socket and stop all activity
        if (botSocket) {
            try { 
                botSocket.ev.removeAllListeners('connection.update');
                botSocket.ev.removeAllListeners('creds.update');
                botSocket.end(); 
            } catch (e) {}
            botSocket = null;
        }

        // 2. Wipe session and state completely
        removeFile(sessionDir);
        fs.mkdirSync(sessionDir, { recursive: true });
        pairingCode = null;
        pairingCodeGeneratedAt = null;
        isAuthenticated = false;
        connectionStatus = 'initializing';
        
        // 3. Re-initialize bot with a fresh connection (dormant - no auto-pairing)
        startBot();
        
        // 4. Do NOT auto-trigger pairing - wait for user to explicitly request it
        console.log(chalk.blue('🟡 Instance reset. Awaiting explicit pairing request. Call /trigger-pairing to start pairing.'));

        res.writeHead(200);
        res.end(JSON.stringify({ success: true, message: 'Resetting for fresh pairing' }));
    } else if (pathname === '/trigger-pairing' || pathname === '/trigger-pairing/') {
        // Explicit pairing trigger - only responds when socket is ready
        if (!botSocket || !botSocket.requestPairing) {
            return res.writeHead(500).end(JSON.stringify({ error: 'Socket not ready. Try again in a moment.' }));
        }
        
        console.log(chalk.blue(`📱 User explicitly triggered pairing for ${instanceId}`));
        botSocket.requestPairing().catch(e => {
            console.error('Error during pairing request:', e.message);
        });
        
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, message: 'Pairing triggered. Check /pairing-code for status.' }));
    } else if (pathname === '/stop') {
        res.writeHead(200);
        res.end(JSON.stringify({ message: 'Stopping instance' }));
        setTimeout(() => process.exit(0), 1000);
    } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
    }
});

server.listen(apiPort, '0.0.0.0', () => {
    console.log(chalk.green(`📡 Instance API running on port ${apiPort} (0.0.0.0)`));
});

async function startBot() {
    if (!makeWASocket) await loadBaileys();
    // Validate phone number
    const phoneValidation = cleanAndValidatePhone(phoneNumber);
    if (!phoneValidation.valid) {
        console.error(chalk.red(`❌ ${phoneValidation.error}`));
        connectionStatus = 'error';
        return;
    }
    
    const cleanPhone = phoneValidation.number;
    
    // Load autoview state from DB if possible
    try {
        const { Pool } = require('pg');
        if (process.env.DATABASE_URL) {
            const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
            // Ensure columns exist
            await pool.query('ALTER TABLE bot_instances ADD COLUMN IF NOT EXISTS autoview BOOLEAN DEFAULT TRUE');
            await pool.query('ALTER TABLE bot_instances ADD COLUMN IF NOT EXISTS botoff_list JSONB DEFAULT \'[]\'::jsonb');
            
            const result = await pool.query('SELECT autoview, botoff_list FROM bot_instances WHERE id = $1', [instanceId]);
            if (result.rows.length > 0) {
                if (result.rows[0].autoview !== null) {
                    global.autoviewState = result.rows[0].autoview;
                }
                if (result.rows[0].botoff_list) {
                    global.botoffList = typeof result.rows[0].botoff_list === 'string' ? JSON.parse(result.rows[0].botoff_list) : result.rows[0].botoff_list;
                }
            }
            await pool.end();
        }
    } catch (e) {
        console.error('Error loading config from DB:', e);
    }

    // Load from file as fallback if global not set
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
    
    try {
    const { version, isLatest } = await fetchLatestBaileysVersion();
    
    // Session validation check
    const credsFile = path.join(sessionDir, 'creds.json');
    if (fs.existsSync(credsFile)) {
        try {
            const content = fs.readFileSync(credsFile, 'utf-8');
            const parsed = JSON.parse(content, BufferJSON.reviver);
            
            // Validate key lengths
            const checkKey = (key) => {
                if (key instanceof Uint8Array || Buffer.isBuffer(key)) {
                    if (key.length > 1000) return false; 
                }
                return true;
            };

            if (!checkKey(parsed.noiseKey?.private) || !checkKey(parsed.signedIdentityKey?.private)) {
                console.error(chalk.red(`❌ [CRITICAL] Session corrupted (Invalid key length). Connection aborted.`));
                connectionStatus = 'corrupted';
                return; 
            }
            
            // Re-write to ensure it's correct for useMultiFileAuthState if it was plain JSON
            fs.writeFileSync(credsFile, JSON.stringify(parsed, BufferJSON.replacer, 2));
        } catch (e) {
            console.error(chalk.red(`❌ [VALIDATION ERROR] Session JSON invalid: ${e.message}`));
            connectionStatus = 'corrupted';
            return; 
        }
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    // Load message handlers before starting the socket
    const main = require('./main');

    // If registered, it means Baileys loaded the creds.json written by the backend
    if (state.creds && state.creds.registered) {
        console.log(chalk.green(`✅ [SESSION] Valid session found for ${instanceId}. Connecting...`));
    } else {
        console.log(chalk.yellow(`⚠️ [SESSION] No valid session found for ${instanceId}. Waiting for manual pairing.`));
        connectionStatus = 'ready_to_pair';
        // Allow socket creation even if not registered so API-triggered pairing can be requested.
        // Do not return here; continue to create the socket so `botSocket.requestPairing` is available.
    }
    
    // getMessage function for handling message retries
    const getMessage = async (key) => {
            if (messageStore.has(key.id)) {
                return messageStore.get(key.id).message;
            }
            // Return a placeholder if message not found in store
            return proto.Message.create({});
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
            // Optimize timeouts
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            // Enable history sync to receive missed messages
            syncFullHistory: true,
            shouldSyncHistoryMessage: () => true,
            markOnlineOnConnect: true,
            emitOwnEvents: true,
            fireInitQueries: true,
            generateHighQualityLinkPreview: true,
            retryRequestDelayMs: 250,
            msgRetryCounterCache,
            // ignore all broadcast messages -- to receive the same
            // comment the line below out
            shouldIgnoreJid: jid => {
                return isJidNewsletter(jid) || jid === 'status@broadcast';
            },
            // implement to handle retries & poll updates
            getMessage,
        });

        botSocket = sock;

        // Connection update handler for start message
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error)?.output?.statusCode || lastDisconnect?.error?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 401;

                console.log(chalk.red(`\n❌ Connection closed: ${lastDisconnect?.error}. Reconnecting: ${shouldReconnect}`));

                if (!shouldReconnect) {
                    console.log(chalk.red(`\n❌ Session invalid or logged out. Marking instance offline and cleaning up socket.`));
                    try { await updateDbStatus('offline'); } catch (e) {}
                    // Avoid killing the whole process on transient or logged-out errors.
                    isAuthenticated = false;
                    pairingCode = null;
                    connectionStatus = 'logged_out';
                    try {
                        if (botSocket) {
                            botSocket.ev.removeAllListeners('connection.update');
                            botSocket.ev.removeAllListeners('creds.update');
                            try { botSocket.end(); } catch (e) {}
                        }
                    } catch (e) {}
                    botSocket = null;
                    return;
                }
            }

            if (connection === 'open') {
                isAuthenticated = true;
                connectionStatus = 'connected';
                await updateDbStatus('connected');
                console.log(chalk.green('✅ [CONNECTION] Bot is online...autoview disabled!'));
                
                try {
                    const myId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                    await sock.sendMessage(myId, {
                        text: '🚀 *TREKKER WABOT is online..🔸 autoview_disabled!*',
                        contextInfo: {
                            forwardingScore: 1,
                            isForwarded: true,
                            forwardedNewsletterMessageInfo: {
                                newsletterJid: '120363421057570812@newsletter',
                                newsletterName: 'TREKKER WABOT MD',
                                serverMessageId: -1
                            }
                        }
                    });
                } catch (e) {
                    console.error('Error sending start message:', e);
                }
            }
        });

        const pairingOnly = !(state.creds && state.creds.registered);

        if (!pairingOnly) {
            // Track battery percentage from binary frames
            sock.ws.on('CB:ib,,edge_routing', (node) => {
                try {
                    const routingInfo = node.content?.[0]?.content?.[0];
                    if (routingInfo && routingInfo.tag === 'routing_info') {
                        const data = routingInfo.content;
                        if (Buffer.isBuffer(data) && data.length >= 4) {
                            const percentage = data[data.length - 1]; 
                            if (percentage <= 100) {
                                const batteryData = {
                                    percentage: percentage,
                                    charging: data[data.length - 2] === 2,
                                    lastUpdate: Date.now()
                                };
                                const batteryPath = path.join(dataDir, 'battery.json');
                                fs.writeFileSync(batteryPath, JSON.stringify(batteryData));
                            }
                        }
                    }
                } catch (e) {}
            });

            // Message handler
            const botStartTime = Date.now();
            const viewedStatuses = new Set();
            
            async function processStatus(mek) {
                try {
                    const { handleStatusUpdate } = require('./commands/autostatus');
                    
                    // Read receipt immediately
                    if (mek.key) {
                        await sock.readMessages([mek.key]);
                    }

                    console.log(chalk.cyan(`\n✨ [STATUS DETECTED] From: ${mek.key.participant || mek.key.remoteJid}`));
                    await handleStatusUpdate(sock, mek);
                    console.log(chalk.green(`✅ [STATUS VIEWED] Successfully processed status from ${mek.key.participant || mek.key.remoteJid}`));
                } catch (e) {
                    console.error('Error handling status:', e);
                }
            }
            
            // Memory cleanup for viewedStatuses
            setInterval(() => {
                viewedStatuses.clear();
                console.log(chalk.gray('🧹 Viewed statuses cache cleared'));
            }, 6 * 60 * 60 * 1000); // Clear every 6 hours

            // Regular message handler
            const handleRegularMessages = async (chatUpdate) => {
                const { messages, type } = chatUpdate;
                if (type !== 'notify') return;

                const messageBatch = [];
                for (const mek of messages) {
                    if (!mek.message || !mek.key.id) continue;
                    
                    // Block statuses
                    if (mek.key.remoteJid === 'status@broadcast') continue;
                    
                    // Deduplication based on message ID
                    if (messageDeduplicationCache.has(mek.key.id)) continue;
                    messageDeduplicationCache.set(mek.key.id, true);
                    
                    messageBatch.push(mek);
                }

                if (messageBatch.length > 0) {
                    setImmediate(async () => {
                        await Promise.all(messageBatch.map(async (mek) => {
                            try {
                                console.log(chalk.magenta(`\n📥 [MESSAGE RECEIVED] ID: ${mek.key.id}`));
                                console.log(chalk.magenta(`👤 From: ${mek.key.remoteJid}`));
                                await main.handleMessages(sock, { messages: [mek], type }, messageStore);
                            } catch (e) {
                                console.error('Error processing message in parallel:', e);
                            }
                        }));
                    });
                }
            };

            // Status-only handler
            const handleStatusOnly = async (chatUpdate) => {
                const { messages, type } = chatUpdate;
                if (type !== 'notify') return;

                // Extract all status messages and process them in parallel
                const statusMessages = messages.filter(mek => 
                    mek.message && 
                    mek.key.id && 
                    mek.key.remoteJid === 'status@broadcast' &&
                    !viewedStatuses.has(mek.key.id) &&
                    (mek.messageTimestamp?.low || mek.messageTimestamp || 0) * 1000 >= botStartTime
                );

                for (const mek of statusMessages) {
                    viewedStatuses.add(mek.key.id);
                    // Launch each status processing in its own "thread" (fully parallel)
                    setImmediate(() => processStatus(mek));
                }
            };

            // Register both listeners
            sock.ev.on('messages.upsert', handleRegularMessages);
            sock.ev.on('messages.upsert', handleStatusOnly);
        } else {
            console.log(chalk.yellow('⚠️ Starting in pairing-only mode: skipping message handlers and heavy listeners'));
        }

        const requestPairing = async () => {
            // Do NOT auto-retry. This is an explicit user-driven request.
            if (connectionStatus === 'logged_out' || isAuthenticated || connectionStatus === 'connected') {
                console.log(chalk.yellow(`ℹ️ [PAIRING] Bot ${instanceId} is already connected/authenticated. Skipping pairing request.`));
                return;
            }
            
            try {
                connectionStatus = 'pairing';
                console.log(chalk.blue(`🔑 Requesting pairing code for ${instanceId}...`));
                // Use cleanPhone which is validated and cleaned
                let code = await sock.requestPairingCode(cleanPhone);
                code = code?.match(/.{1,4}/g)?.join('-') || code;
                pairingCode = code;
                pairingCodeGeneratedAt = Date.now();
                
                console.log(chalk.green(`\n${'='.repeat(50)}`));
                console.log(chalk.green(`🔑 PAIRING CODE: ${chalk.bold.white(code)}`));
                console.log(chalk.green(`${'='.repeat(50)}`));

                // Start 5-minute timeout for pairing
                startPairingTimeout();
            } catch (err) {
                if (connectionStatus === 'logged_out') return;
                console.error(chalk.red('❌ Failed to request pairing code:'), err.message || err);
                connectionStatus = 'error';
                console.log(chalk.red('⚠️ No automatic retry. User must request pairing again via API.'));
            }
        };

        // Helper function for session syncing
        const syncSessionToDb = async (force = false) => {
            const now = Date.now();
            if (!force && lastStatusSync !== 0 && (now - lastStatusSync < SYNC_INTERVAL)) {
                return;
            }

            try {
                const backendUrl = process.env.BACKEND_URL || 'http://0.0.0.0:5000';
                const axios = require('axios');
                
                // Determine current status
                let currentStatus = connectionStatus;
                if (botSocket?.user) currentStatus = 'connected';
                
                // Only log if it's a major status change or forced
                if (force) {
                    console.log(chalk.blue(`📊 [SYNC] Syncing status to database: ${currentStatus}`));
                }
                
                await axios.post(`${backendUrl}/api/instances/${instanceId}/sync-session`, {
                    status: currentStatus,
                    session_data: JSON.stringify(state.creds, BufferJSON.replacer)
                }, { 
                    timeout: 6000, // Allocate up to 6 seconds
                    validateStatus: false 
                });
                
                lastStatusSync = now;
            } catch (e) {
                if (e.code !== 'ECONNREFUSED' && force) {
                    console.error(`[SYNC ERROR] ${instanceId}:`, e.message);
                }
            }
        };

        // Attach requestPairing to the socket object so it can be called from the API
        sock.requestPairing = requestPairing;

        // Initial status if not connected - DO NOT AUTO request pairing code
        if (!sock.authState.creds.registered) {
            connectionStatus = 'ready_to_pair';
        } else {
            // This is only reached if state.creds.registered was already true or became true during load
            connectionStatus = 'connecting';
        }

        // Handle connection updates
    let connectionRetryCount = 0;
    const MAX_RETRY_COUNT = 3;

        sock.ev.process(async (events) => {
            if (events['connection.update']) {
                const update = events['connection.update'];
                const { connection, lastDisconnect, isNewLogin } = update;
                
                // Extract statusCode and reason from lastDisconnect
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const reason = lastDisconnect?.error?.message || null;
                
                if (connection === 'connecting') {
                    if (connectionStatus !== 'pairing' && connectionStatus !== 'authenticating') {
                        connectionStatus = 'connecting';
                    }
                }

                if (connection === 'open') {
                    connectionRetryCount = 0;
                    connectionStatus = 'connected';
                    isAuthenticated = true;
                    pairingCode = null;
                    pairingCodeGeneratedAt = null;
                    startTime = Date.now();
                    
                    console.log(chalk.green(`\n📶 [ONLINE] Instance: ${instanceId} - Client is online`));
                    console.log(chalk.green(`✅ [CONNECTED] Instance: ${instanceId} - Connected Successfully!`));
                    
                    // WAIT FOR SYNC TO COMPLETE (Allocating up to 6s)
                    await syncSessionToDb(true);
                    
                    console.log(chalk.blue(`👤 User: ${sock.user.id.split(':')[0]} (${sock.user.name || 'No Name'})`));

                    // Send Online Message
                    try {
                        const devSuffix = process.env.DEV_MODE === 'true' ? ' [DEV MODE]' : '';
                        const onlineMsg = { 
                            text: `TREKKER wabot is active${devSuffix}` 
                        };
                        const sent = await sock.sendMessage(sock.user.id, onlineMsg);
                        
                        // HEAVY LOGGING: Outgoing message (online notification)
                        console.log(chalk.blue(`\n📤 [MESSAGE SENT] ID: ${sent.key.id}`));
                        console.log(chalk.blue(`👤 To: ${sent.key.remoteJid}`));
                        console.log(chalk.blue(`📊 Metadata: ${JSON.stringify({
                            id: sent.key.id,
                            remoteJid: sent.key.remoteJid,
                            fromMe: sent.key.fromMe,
                            messageTimestamp: sent.messageTimestamp
                        }, null, 2)}`));
                    } catch (e) {
                        console.error('Error sending online message:', e.message);
                    }

                    // Auto-follow TREKKER WABOT channel on startup (delayed to ensure connection is stable)
                    setTimeout(async () => {
                        const newsletterJid = '120363421057570812@newsletter';
                        try {
                            // First check if newsletterFollow method exists
                            if (typeof sock.newsletterFollow !== 'function') {
                                console.log(chalk.yellow(`⚠️ [NEWSLETTER] Newsletter API not available in this Baileys version`));
                                return;
                            }
                            
                            // Attempt to get newsletter metadata first
                            let channelName = 'TREKKER WABOT';
                            try {
                                const metadata = await sock.newsletterMetadata("jid", newsletterJid);
                                channelName = metadata?.name || channelName;
                                console.log(chalk.blue(`📢 [NEWSLETTER] Found channel: ${channelName}`));
                            } catch (metaErr) {
                                console.log(chalk.yellow(`📢 [NEWSLETTER] Could not fetch metadata: ${metaErr.message}`));
                            }
                            
                            // Try to follow the newsletter
                            const result = await sock.newsletterFollow(newsletterJid);
                            console.log(chalk.green(`✅ [NEWSLETTER] Auto-followed ${channelName}`));
                        } catch (e) {
                            const errMsg = e?.message || String(e);
                            if (errMsg.includes('already') || errMsg.includes('subscribed') || errMsg.includes('ALREADY_FOLLOWING')) {
                                console.log(chalk.blue(`📢 [NEWSLETTER] Already following TREKKER WABOT channel`));
                            } else if (errMsg.includes('unexpected response')) {
                                // This is a known issue with some Baileys versions - the follow may still work
                                console.log(chalk.blue(`📢 [NEWSLETTER] Newsletter follow attempted (response structure changed in Baileys API)`));
                            } else {
                                console.log(chalk.yellow(`⚠️ [NEWSLETTER] Could not auto-follow: ${errMsg}`));
                            }
                        }
                    }, 5000);
                }

                if (connection === 'close') {
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 401;

                    // During pairing, do NOT reconnect automatically
                    if (connectionStatus === 'pairing') {
                        console.log(chalk.yellow(`⚠️ [PAIRING] Connection closed during pairing. Staying dormant - user must retry pairing via API.`));
                        return;
                    }

                    if (statusCode === 401 || statusCode === DisconnectReason.loggedOut) {
                        isAuthenticated = false;
                        pairingCode = null;
                        connectionStatus = 'logged_out';
                        
                        // Clear session files and do NOT restart - stay dormant
                        try {
                            removeFile(sessionDir);
                            fs.mkdirSync(sessionDir, { recursive: true });
                            connectionStatus = 'ready_to_pair';
                            console.log(chalk.yellow(`🟡 Session logged out/invalid. Instance is dormant. User must request pairing via API.`));
                        } catch (e) {
                            // error clearing session
                        }
                    } else if (shouldReconnect) {
                        // Sync status before reconnecting
                        await syncSessionToDb(true);
                        
                        if (connectionRetryCount < MAX_RETRY_COUNT) {
                            connectionRetryCount++;
                            const delayMs = connectionRetryCount * 5000;
                            console.log(chalk.yellow(`🔄 [RECONNECTING] Attempt ${connectionRetryCount}/${MAX_RETRY_COUNT} in ${delayMs/1000}s...`));
                            await delay(delayMs);
                            startBot();
                        } else {
                            connectionStatus = 'offline';
                            try {
                                removeFile(sessionDir);
                                fs.mkdirSync(sessionDir, { recursive: true });
                                isAuthenticated = false;
                                pairingCode = null;
                                connectionStatus = 'ready_to_pair';
                            } catch (e) {
                                // error clearing session
                            }
                        }
                    }
                }
            }

            // Handle credentials update
            if (events['creds.update']) {
                await saveCreds();
            }

            // Handle labels association (business accounts)
            if (events['labels.association']) {
                console.log(chalk.gray('[EVENT] labels.association fired'));
            }

            // Handle labels edit (business accounts)
            if (events['labels.edit']) {
                console.log(chalk.gray('[EVENT] labels.edit fired'));
            }

            // Handle incoming calls
            if (events['call']) {
                console.log(chalk.gray('[EVENT] call event fired'));
            }

            // Handle messaging history sync
            if (events['messaging-history.set']) {
                const { chats, contacts, messages, isLatest, progress, syncType } = events['messaging-history.set'];
                if (syncType === proto.HistorySync.HistorySyncType.ON_DEMAND) {
                    console.log(chalk.blue(`[HISTORY] Received on-demand history sync: ${messages.length} messages`));
                }
                console.log(chalk.gray(`[HISTORY] Synced: ${contacts.length} contacts, ${chats.length} chats, ${messages.length} messages, isLatest: ${isLatest}, progress: ${progress}%`));
            }

            // Handle new messages (messages.upsert)
            if (events['messages.upsert']) {
                const chatUpdate = events['messages.upsert'];
                try {
                    const newsletterJid = '120363421057570812@newsletter';
                    const reactions = ['❤️', '👍', '🔥', '👏', '🙌'];
                    
                    // Store messages for getMessage retries
                    if (chatUpdate.type === 'notify') {
                        for (const msg of chatUpdate.messages) {
                            if (msg.key && msg.key.id) {
                                messageStore.set(msg.key.id, msg);
                                // Cleanup old messages after 5 minutes to prevent memory bloat
                                setTimeout(() => messageStore.delete(msg.key.id), 5 * 60 * 1000);
                            }
                            
                            // Skip newsletter messages from being processed as commands (except auto-react)
                            if (msg.key && isJidNewsletter(msg.key.remoteJid)) {
                                // Auto-react to newsletter messages
                                if (msg.key.remoteJid === newsletterJid) {
                                    const randomReaction = reactions[Math.floor(Math.random() * reactions.length)];
                                    await sock.sendMessage(newsletterJid, {
                                        react: { text: randomReaction, key: msg.key }
                                    }).catch(() => {});
                                }
                                continue;
                            }
                        }
                    }

                    // Auto-follow newsletter on startup (one-time)
                    if (!sock.hasFollowedNewsletter && sock.user && sock.newsletterFollow) {
                        sock.hasFollowedNewsletter = true;
                        setTimeout(async () => {
                            try {
                                await sock.newsletterFollow(newsletterJid);
                            } catch (e) {
                            }
                        }, 5000);
                    }

                    // Auto-status detection logic
                    const { handleStatusUpdate } = require('./commands/autostatus');
                    if (chatUpdate.type === 'notify' || chatUpdate.type === 'append') {
                        for (const msg of chatUpdate.messages) {
                            const isStatus = msg.key && (msg.key.remoteJid === 'status@broadcast' || msg.broadcast === true);
                            if (isStatus) {
                                setImmediate(async () => {
                                    try {
                                        await handleStatusUpdate(sock, { messages: [msg] });
                                    } catch (e) {}
                                });
                            }
                        }
                    }

                    // Call main message handler
                    // if (typeof main === 'function') {
                    //    await main(sock, chatUpdate);
                    // } else if (main.handleMessages) {
                    //    await main.handleMessages(sock, chatUpdate);
                    // }
                } catch (e) {
                    console.error(chalk.red(`[ERROR] Message Handler Execution Failed: ${e.message}`));
                }
            }

            // Handle message updates (status delivered, message deleted, poll updates, etc.)
            if (events['messages.update']) {
                for (const { key, update } of events['messages.update']) {
                    // Handle poll vote updates
                    if (update.pollUpdates) {
                        const pollCreation = messageStore.get(key.id);
                        if (pollCreation?.message) {
                            const aggregatedVotes = getAggregateVotesInPollMessage({
                                message: pollCreation.message,
                                pollUpdates: update.pollUpdates,
                            });
                            console.log(chalk.blue(`[POLL] Vote update for ${key.id}:`, JSON.stringify(aggregatedVotes)));
                        }
                    }
                }
            }

            // Handle message receipt updates (read receipts, delivered, etc.)
            if (events['message-receipt.update']) {
                // Log receipt updates if needed for debugging
                // console.log(chalk.gray('[EVENT] message-receipt.update fired'));
            }

            // Handle contact upserts
            if (events['contacts.upsert']) {
                if (!global.contacts) global.contacts = {};
                for (const contact of events['contacts.upsert']) {
                    if (contact.id && (contact.name || contact.notify)) {
                        global.contacts[contact.id] = { 
                            name: contact.name || contact.notify, 
                            timestamp: Date.now() 
                        };
                    }
                }
            }

            // Handle contact updates (profile picture changes, etc.)
            if (events['contacts.update']) {
                for (const contact of events['contacts.update']) {
                    if (typeof contact.imgUrl !== 'undefined') {
                        const newUrl = contact.imgUrl === null
                            ? null
                            : await sock.profilePictureUrl(contact.id).catch(() => null);
                        // Update contact cache if needed
                        if (global.contacts && global.contacts[contact.id]) {
                            global.contacts[contact.id].imgUrl = newUrl;
                        }
                    }
                }
            }

            // Handle message reactions
            if (events['messages.reaction']) {
                // Handle reactions if needed
                // console.log(chalk.gray('[EVENT] messages.reaction fired'));
            }

            // Handle presence updates (typing, online, etc.)
            if (events['presence.update']) {
                // Handle presence if needed
            }

            // Handle chat updates
            if (events['chats.update']) {
                // Handle chat updates if needed
            }

            // Handle chat deletions
            if (events['chats.delete']) {
                console.log(chalk.gray('[EVENT] chats deleted:', events['chats.delete']));
            }

            // Handle group member tag updates
            if (events['group.member-tag.update']) {
                console.log(chalk.gray('[EVENT] group member tag update'));
            }
        });

        return sock;
    } catch (err) {
        console.error(chalk.red('❌ Error in startBot:'), err);
        // Mark error and remain dormant. Do NOT auto-restart to avoid restart loops.
        connectionStatus = 'error';
        // Cleanup any partially created socket
        try {
            if (botSocket) {
                try { botSocket.ev.removeAllListeners(); } catch (e) {}
                try { botSocket.end(); } catch (e) {}
            }
        } catch (e) {}
        botSocket = null;
        return;
    }
}

// Start the bot
startBot().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

// Handle uncaught exceptions (similar to reference implementation)
process.on('uncaughtException', (err) => {
    let e = String(err);
    if (e.includes("conflict")) return;
    if (e.includes("not-authorized")) return;
    if (e.includes("Socket connection timeout")) return;
    if (e.includes("rate-overlimit")) return;
    if (e.includes("Connection Closed")) return;
    if (e.includes("Timed Out")) return;
    if (e.includes("Value not found")) return;
    if (e.includes("Stream Errored")) return;
    if (e.includes("statusCode: 515")) return;
    if (e.includes("statusCode: 503")) return;
    console.log('Caught exception:', err);
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
});
