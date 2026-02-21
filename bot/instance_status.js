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
async function updateDbStatus(status, force = false) {
    if (!process.env.DATABASE_URL) return;
    
    // Simplified updateDbStatus: remove pairing/syncing status updates to database
    // We only update when connected or explicitly offline
    if (status !== 'connected' && status !== 'offline') return;
    
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    try {
        await pool.query('UPDATE bot_instances SET status = $1, updated_at = NOW() WHERE id = $2', [status, instanceId]);
        global.lastDbUpdate = Date.now();
    } catch (e) {
        if (e.code !== 'EMFILE' && !e.message.includes('getaddrinfo')) {
            console.error('Error updating DB status:', e);
        }
    } finally {
        await pool.end();
    }
}

// Timeout check - removed automatic close
function startPairingTimeout() {
    // No-op: keep instance alive
}

const PAIRING_RETRY_INTERVAL = 5000; // 5 seconds interval for pairing retry

// Global state
let pairingCode = null;
let pairingCodeGeneratedAt = null;
let connectionStatus = 'initializing';
let botSocket = null;
let isAuthenticated = false;
let startTime = Date.now();
let lastStatusSync = 0;
const SYNC_INTERVAL = 60 * 60 * 1000; // 1 hour
const PAIRING_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

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
    const phone = pn('+' + num);
    if (!phone.isValid()) {
        return { valid: false, error: 'Invalid phone number. Please enter your full international number without + or spaces.' };
    }
    
    // Return E.164 format without +
    return { valid: true, number: phone.getNumber('e164').replace('+', '') };
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
        // Trigger pairing if not already paired and not authenticated
        if (!pairingCode && !isAuthenticated && connectionStatus === 'ready_to_pair') {
            console.log(chalk.blue(`[API] Pairing code requested for ${instanceId}, triggering generation...`));
            if (botSocket && botSocket.requestPairing) {
                botSocket.requestPairing().catch(e => {
                    console.error('Error triggering requestPairing:', e.message);
                });
            }
        }
        
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
        
        // 3. Re-initialize bot with a fresh connection
        startBot();
        
        // 4. Wait for connection to be ready before calling requestPairing
        let attempts = 0;
        const checkReady = setInterval(() => {
            if (botSocket && botSocket.requestPairing) {
                clearInterval(checkReady);
                botSocket.requestPairing().catch(e => {
                    console.error('Error triggering requestPairing:', e.message);
                });
            }
            if (attempts++ > 40) {
                clearInterval(checkReady);
                console.log(chalk.red('❌ Timed out waiting for botSocket to be ready for pairing'));
                connectionStatus = 'error';
            }
        }, 500);

        res.writeHead(200);
        res.end(JSON.stringify({ success: true, message: 'Resetting for fresh pairing' }));
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
        // Suppress EMFILE and connection errors during pairing
        if (e.code !== 'EMFILE' && !e.message.includes('getaddrinfo')) {
            console.error('Error loading config from DB:', e);
        }
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
    if (fs.existsSync(credsFile) && connectionStatus !== 'ready_to_pair' && connectionStatus !== 'pairing') {
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
        // Keep the process alive for pairing attempts for at least 5 minutes
        startPairingTimeout();
        // Continue and create the socket so `requestPairing` is available over the API
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
                return isJidNewsletter(jid);
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
                // Always try to reconnect unless logged out
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                console.log(chalk.red(`\n❌ Connection closed: ${lastDisconnect?.error}. Reconnecting: ${shouldReconnect}`));

                if (shouldReconnect) {
                    console.log(chalk.yellow(`🔄 Reconnecting bot ${instanceId}...`));
                    setTimeout(() => startBot().catch(() => {}), 5000);
                } else {
                    console.log(chalk.red(`\n❌ Session invalid or logged out. Bot remains in ready state.`));
                    connectionStatus = 'ready_to_pair';
                }
            }

            if (connection === 'open') {
                isAuthenticated = true;
                connectionStatus = 'connected';
                pairingCode = null;
                pairingCodeGeneratedAt = null;
                await updateDbStatus('connected', true);
                console.log(chalk.green('✅ [CONNECTION] Bot is online and registered!'));
                
                try {
                    const myId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                    await sock.sendMessage(myId, {
                        text: '🚀 *TREKKER WABOT is online..✅autoview_enabled!*',
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

        let pairingRetryCount = 0;
        const MAX_PAIRING_RETRIES = 15;
        
        const requestPairing = async () => {
            if (connectionStatus === 'logged_out' || isAuthenticated || connectionStatus === 'connected') {
                console.log(chalk.yellow(`ℹ️ [PAIRING] Bot ${instanceId} is already connected/authenticated. Skipping pairing request.`));
                return;
            }
            
            // Check retry count
            if (pairingRetryCount >= MAX_PAIRING_RETRIES) {
                console.log(chalk.red(`❌ Max pairing retries (${MAX_PAIRING_RETRIES}) reached for ${instanceId}`));
                connectionStatus = 'error';
                return;
            }

            // Ensure we don't request too fast
            await delay(2000);
            
            try {
                connectionStatus = 'pairing';
                pairingRetryCount++;
                console.log(chalk.blue(`🔑 Requesting pairing code (attempt ${pairingRetryCount}/${MAX_PAIRING_RETRIES})...`));
                // Use cleanPhone which is validated and cleaned
                let code = await sock.requestPairingCode(cleanPhone);
                code = code?.match(/.{1,4}/g)?.join('-') || code;
                pairingCode = code;
                pairingCodeGeneratedAt = Date.now();
                pairingRetryCount = 0; // Reset on success
                
                console.log(chalk.green(`\n${'='.repeat(50)}`));
                console.log(chalk.green(`🔑 PAIRING CODE: ${chalk.bold.white(code)}`));
                console.log(chalk.green(`${'='.repeat(50)}`));

                // Start 5-minute timeout for pairing (manual/pair command only)
                startPairingTimeout();
            } catch (err) {
                if (connectionStatus === 'logged_out') return;
                console.error(chalk.red('❌ Failed to request pairing code:'), err.message || err);
                
                if (err.message && err.message.includes('rate-overlimit')) {
                    console.log(chalk.yellow('⏳ Rate limit hit, retrying in 30s...'));
                    setTimeout(requestPairing, 30000);
                } else if (err.message && (err.message.includes('Connection Closed') || err.message.includes('Precondition Required'))) {
                    // Connection not ready, wait and retry
                    console.log(chalk.yellow('🔄 Connection not ready, retrying in 10s...'));
                    connectionStatus = 'connecting';
                    setTimeout(requestPairing, 10000);
                } else {
                    console.log(chalk.yellow('🔄 Retrying pairing code request in 12s...'));
                    setTimeout(requestPairing, 12000);
                }
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
                    // Clear pairing codes to indicate successful connection
                    pairingCode = null;
                    pairingCodeGeneratedAt = null;
                    // Clear any active pairing timeout since we're now connected
                    // pairingTimeout check removed as it's no longer used
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
                    const statusCode = (lastDisconnect?.error)?.output?.statusCode || lastDisconnect?.error?.statusCode;
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 401;

                    console.log(chalk.red(`\n❌ Connection closed: ${lastDisconnect?.error}`));

                    const now = Date.now();
                    // Check if we were previously authenticated OR if we're within the pairing window
                    const wasPreviouslyConnected = isAuthenticated;
                    const pairingActive = pairingCodeGeneratedAt && (now - pairingCodeGeneratedAt) < PAIRING_WINDOW_MS;

                    if ((statusCode === 401 || statusCode === DisconnectReason.loggedOut) && !wasPreviouslyConnected && !pairingActive) {
                        // Fresh logout during non-pairing time: clear session and restart for re-pairing
                        console.log(chalk.red(`\n❌ Session invalid/logged out and outside pairing window. Clearing and restarting.`));
                        isAuthenticated = false;
                        pairingCode = null;
                        connectionStatus = 'logged_out';
                        try {
                            removeFile(sessionDir);
                            fs.mkdirSync(sessionDir, { recursive: true });
                            startBot();
                        } catch (e) {}
                    } else if (wasPreviouslyConnected || pairingActive) {
                        // We were authenticated OR still within pairing window: keep retrying
                        if (wasPreviouslyConnected) {
                            console.log(chalk.yellow(`🔄 Connection dropped after successful connection. Retrying...`));
                        } else {
                            console.log(chalk.yellow(`🔄 Connection closed during pairing window. Retrying for up to ${PAIRING_WINDOW_MS / 1000}s more...`));
                        }

                        // Sync status before reconnecting
                        await syncSessionToDb(true);

                        // Retry loop: keep trying until pairing window expires or connection succeeds
                        let retryAttempt = 0;
                        const maxRetries = Math.ceil(PAIRING_WINDOW_MS / 3000);
                        
                        const retryInterval = setInterval(async () => {
                            retryAttempt++;
                            const elapsedSincePairingCode = pairingCodeGeneratedAt ? (Date.now() - pairingCodeGeneratedAt) : PAIRING_WINDOW_MS;
                            const timeRemaining = PAIRING_WINDOW_MS - elapsedSincePairingCode;

                            if (isAuthenticated || connectionStatus === 'connected') {
                                clearInterval(retryInterval);
                                console.log(chalk.green('✅ Reconnected successfully'));
                                return;
                            }

                            if (timeRemaining <= 0) {
                                clearInterval(retryInterval);
                                console.log(chalk.red('❌ Pairing/connection window expired. Exiting.'));
                                await updateDbStatus('offline');
                                process.exit(1);
                                return;
                            }

                            console.log(chalk.blue(`🔁 Reconnect attempt ${retryAttempt} (${Math.ceil(timeRemaining / 1000)}s remaining)`));
                            try {
                                await updateDbStatus('connecting');
                                startBot().catch(() => {});
                            } catch (e) {
                                console.error('Retry error:', e.message);
                            }
                        }, 3000);
                    } else if (shouldReconnect) {
                        // Other connection errors: standard reconnect logic
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
                            } catch (e) {}
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
        connectionStatus = 'error';
        await delay(5000);
        startBot();
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
