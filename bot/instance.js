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
let makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, jidDecode, proto, jidNormalizedUser, makeCacheableSignalKeyStore, delay, Browsers, BufferJSON;

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
}

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

// Global state
let pairingCode = null;
let pairingCodeGeneratedAt = null;
let connectionStatus = 'initializing';
let botSocket = null;
let isAuthenticated = false;
let startTime = Date.now();
const CONNECTION_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// Timeout check
setInterval(() => {
    if (isAuthenticated) {
        startTime = Date.now(); // Reset start time if authenticated
        return;
    }
    if (!isAuthenticated && (Date.now() - startTime > CONNECTION_TIMEOUT)) {
        console.log(chalk.red(`\n❌ Connection not established within 5 minutes. Closing instance: ${instanceId}`));
        process.exit(1);
    }
}, 30000);

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
    console.log(chalk.blue(`📱 Using phone number: ${cleanPhone}`));
    
    try {
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(chalk.gray(`📦 Using Baileys version: ${version.join('.')}, isLatest: ${isLatest}`));
    
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
        
        // If registered, it means Baileys loaded the creds.json written by the backend
        if (state.creds && state.creds.registered) {
            console.log(chalk.green(`✅ Session restored from filesystem for ${instanceId}`));
        } else {
            console.log(chalk.yellow(`ℹ️ No registered session found on filesystem for ${instanceId}`));
            // Log what we have in state.creds for debugging
            if (state.creds) {
                console.log(chalk.gray(`📊 Current state.creds keys: ${Object.keys(state.creds).join(', ')}`));
            }
        }
        const sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }).child({ level: "fatal" }),
            browser: Browsers.windows('Chrome'),
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: false,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            retryRequestDelayMs: 250,
        });

        botSocket = sock;

        // Ensure session is saved periodically
        sock.ev.on('creds.update', saveCreds);

        let pairingRetryCount = 0;
        const MAX_PAIRING_RETRIES = 5;
        
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

                // Add 5-minute timeout for pairing
                setTimeout(() => {
                    if (connectionStatus === 'pairing' && !isAuthenticated) {
                        console.log(chalk.yellow(`⏳ Pairing timeout reached for ${instanceId}. Closing...`));
                        process.exit(1);
                    }
                }, 5 * 60 * 1000);
            } catch (err) {
                if (connectionStatus === 'logged_out') return;
                console.error(chalk.red('❌ Failed to request pairing code:'), err.message || err);
                
                if (err.message && err.message.includes('rate-overlimit')) {
                    console.log(chalk.yellow('⏳ Rate limit hit, retrying in 30s...'));
                    setTimeout(requestPairing, 30000);
                } else if (err.message && (err.message.includes('Connection Closed') || err.message.includes('Precondition Required'))) {
                    // Connection not ready, wait and retry
                    console.log(chalk.yellow('🔄 Connection not ready, retrying in 8s...'));
                    connectionStatus = 'connecting';
                    setTimeout(requestPairing, 8000);
                } else {
                    console.log(chalk.yellow('🔄 Retrying pairing code request in 10s...'));
                    setTimeout(requestPairing, 10000);
                }
            }
        };

        // Attach requestPairing to the socket object so it can be called from the API
        sock.requestPairing = requestPairing;

        // Initial status if not connected - DO NOT AUTO request pairing code
        if (!sock.authState.creds.registered) {
            console.log(chalk.blue('👋 Session not registered. Waiting for pairing request...'));
            connectionStatus = 'ready_to_pair';
            // REMOVED: Auto-request pairing code after a short delay
        } else {
            // This is only reached if state.creds.registered was already true or became true during load
            connectionStatus = 'connecting';
        }
        
        // Handle credentials update
        sock.ev.on('creds.update', async (update) => {
            await saveCreds();
            // Sync credentials to database for persistence
            try {
                const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:5000';
                const axios = require('axios');
                await axios.post(`${backendUrl}/api/instances/${instanceId}/sync-session`, {
                    session_data: JSON.stringify(state.creds, BufferJSON.replacer)
                }, { timeout: 5000, validateStatus: false });
            } catch (e) {
                if (e.code !== 'ECONNREFUSED') {
                    console.error(`[SYNC ERROR] Failed to sync session for ${instanceId}:`, e.message);
                }
            }
        });

        // Handle connection updates
    let connectionRetryCount = 0;
    const MAX_RETRY_COUNT = 3;

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, isNewLogin, isOnline } = update;

        // Sync status to database on every update
        try {
            const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:5000';
            const axios = require('axios');
            let dbStatus = connectionStatus;
            
            // Map internal status to database status if needed
            if (connection === 'open') dbStatus = 'connected';
            else if (connection === 'connecting') dbStatus = 'connecting';
            else if (connection === 'close') dbStatus = 'disconnected';

            await axios.post(`${backendUrl}/api/instances/${instanceId}/sync-session`, {
                status: dbStatus,
                last_error: lastDisconnect?.error?.message || null,
                session_data: JSON.stringify(state.creds, BufferJSON.replacer)
            }, { timeout: 5000, validateStatus: false });
        } catch (e) {
            if (e.code !== 'ECONNREFUSED') {
                console.error(`[STATUS SYNC ERROR] ${instanceId}:`, e.message);
            }
        }

        if (connection === 'connecting') {
            if (connectionStatus !== 'pairing') {
                connectionStatus = 'connecting';
            }
            console.log(chalk.yellow(`🔄 [CONNECTING] Instance: ${instanceId} - Connecting to WhatsApp...`));
        }

        if (connection === 'open') {
            connectionRetryCount = 0; // Reset retry count on success
            connectionStatus = 'connected';
            isAuthenticated = true;
            pairingCode = null; // Clear pairing code once connected
            pairingCodeGeneratedAt = null;
            startTime = Date.now(); // Reset start time on success
            
            console.log(chalk.green(`\n📶 [ONLINE] Instance: ${instanceId} - Client is online`));
            console.log(chalk.green(`✅ [CONNECTED] Instance: ${instanceId} - Connected Successfully!`));
            console.log(chalk.blue(`👤 User: ${sock.user.id.split(':')[0]} (${sock.user.name || 'No Name'})`));
            
            // ... (rest of the 'open' logic)
        }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const reason = lastDisconnect?.error?.message || 'No reason provided';
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 401;

                console.log(chalk.red(`\n❌ [DISCONNECT] Instance: ${instanceId} - Status: ${statusCode}, Reason: ${reason}, Reconnect: ${shouldReconnect}`));
                
                // Sync status immediately on 401
                if (statusCode === 401 || statusCode === DisconnectReason.loggedOut) {
                    try {
                        const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:5000';
                        const axios = require('axios');
                        await axios.post(`${backendUrl}/api/instances/${instanceId}/sync-session`, {
                            status: 'unauthorized',
                            last_error: reason
                        }, { timeout: 5000, validateStatus: false });
                    } catch (e) {}
                }
                
                if (statusCode === 408) {
                    console.log(chalk.yellow(`⚠️ [TIMEOUT] Instance: ${instanceId} - Request timed out (408). This usually indicates network issues or slow connection.`));
                }

                if (statusCode === 440) {
                    console.log(chalk.yellow(`⚠️ [STATUS 440] Instance: ${instanceId} - Session expired or conflict (440). Syncing session and retrying...`));
                    try {
                        const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:5000';
                        const axios = require('axios');
                        await axios.post(`${backendUrl}/api/instances/${instanceId}/sync-session`, {
                            status: 'disconnected',
                            last_error: 'Session expired (440)',
                            session_data: JSON.stringify(state.creds, BufferJSON.replacer)
                        }, { timeout: 5000, validateStatus: false });
                    } catch (e) {}
                }

                if (lastDisconnect?.error) {
                    try {
                        console.log(chalk.gray(`[DEBUG] Full Error for ${instanceId}: ${JSON.stringify(lastDisconnect.error, null, 2)}`));
                    } catch (e) {
                        console.log(chalk.gray(`[DEBUG] Full Error for ${instanceId}: ${lastDisconnect.error}`));
                    }
                }
                
                if (statusCode === 401 || statusCode === DisconnectReason.loggedOut) {
                    console.log(chalk.yellow("❌ Logged out from WhatsApp. Bot will remain idle until manual action."));
                    isAuthenticated = false;
                    pairingCode = null;
                    connectionStatus = 'logged_out';
                    
                    // Clear session files to allow clean pairing later
                    try {
                        removeFile(sessionDir);
                        fs.mkdirSync(sessionDir, { recursive: true });
                        // Re-initialize for new pairing if it was a logout
                        console.log(chalk.blue("🔄 Re-initializing bot for new pairing after logout..."));
                        startBot();
                    } catch (e) {
                        console.error('Error clearing session on logout:', e);
                    }
                } else if (shouldReconnect) {
                    if (connectionRetryCount < MAX_RETRY_COUNT) {
                        // Check for corruption before retrying
                        const credsFile = path.join(sessionDir, 'creds.json');
                        if (fs.existsSync(credsFile)) {
                            try {
                                const content = fs.readFileSync(credsFile, 'utf-8');
                                if (content.length > 50000) { // Arbitrary size limit to detect bloat
                                    console.error(chalk.red(`❌ [RETRY PREVENTED] Session file is too large (${content.length} bytes). Corruption likely.`));
                                    connectionStatus = 'corrupted';
                                    return;
                                }
                            } catch (e) {}
                        }
                        connectionRetryCount++;
                        console.log(chalk.yellow(`🔁 [RETRY ${connectionRetryCount}/${MAX_RETRY_COUNT}] Instance: ${instanceId} - Restarting in 5 seconds...`));
                        await delay(5000);
                        startBot();
                    } else {
                        console.log(chalk.red(`\n🚫 [RETRY LIMIT REACHED] Instance: ${instanceId} - Failed to reconnect after ${MAX_RETRY_COUNT} attempts.`));
                        console.log(chalk.yellow(`🧹 [CLEANUP] Clearing invalid session and waiting for manual pairing...`));
                        
                        try {
                            removeFile(sessionDir);
                            fs.mkdirSync(sessionDir, { recursive: true });
                            isAuthenticated = false;
                            pairingCode = null;
                            connectionStatus = 'ready_to_pair';
                            // Bot stays idle now
                        } catch (e) {
                            console.error('Error clearing session on retry limit:', e);
                        }
                    }
                } else {
                    connectionStatus = 'disconnected';
                }
            }
    });

        // Decode JID helper
        sock.decodeJid = (jid) => {
            if (!jid) return jid;
            if (/:\d+@/gi.test(jid)) {
                let decode = jidDecode(jid) || {};
                return decode.user && decode.server && decode.user + '@' + decode.server || jid;
            } else return jid;
        };

        sock.ev.on('messages.upsert', async (chatUpdate) => {
            try {
                const main = require('./main');
                if (typeof main === 'function') {
                    await main(sock, chatUpdate);
                } else if (main.handleMessages) {
                    await main.handleMessages(sock, chatUpdate);
                }
            } catch (e) {
                console.error(chalk.red(`[ERROR] Message Handler Execution Failed: ${e.message}`));
            }
        });
        console.log(chalk.green(`✅ [LOADED] Message Handler for ${instanceId} loaded successfully`));

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
