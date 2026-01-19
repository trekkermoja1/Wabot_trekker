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
        console.log(chalk.blue(`📱 Pairing code request for ${instanceId}. Status: ${connectionStatus}`));
        
        // Trigger pairing if requested and not already paired/pairing
        if (!isAuthenticated && connectionStatus !== 'pairing' && connectionStatus !== 'connected') {
            if (botSocket && botSocket.requestPairing) {
                console.log(chalk.blue('🔑 Automatically triggering requestPairing() on code request.'));
                botSocket.requestPairing();
            } else {
                console.log(chalk.yellow('⚠️ Socket not ready for pairing, will retry on next poll.'));
            }
        } else if (connectionStatus === 'logged_out') {
            console.log(chalk.blue('👋 Logged out state detected, restarting bot for new pairing...'));
            // Clear existing session and restart
            removeFile(sessionDir);
            fs.mkdirSync(sessionDir, { recursive: true });
            startBot();
        }

        res.writeHead(200);
        res.end(JSON.stringify({
            pairingCode: pairingCode || null,
            pairingCodeGeneratedAt,
            status: connectionStatus,
            isAuthenticated
        }));
    } else if (pathname === '/regenerate-code' && req.method === 'POST') {
        console.log(chalk.blue('📱 Regenerate pairing code requested'));
        
        // Clear existing session and restart
        connectionStatus = 'regenerating';
        pairingCode = null;
        
        try {
            // Close existing socket if any
            if (botSocket) {
                try {
                    botSocket.end();
                } catch (e) {}
                botSocket = null;
            }
            
            // Remove existing session
            removeFile(sessionDir);
            fs.mkdirSync(sessionDir, { recursive: true });
            
            // Restart the bot
            await delay(1000);
            await startBot();
            
            // Wait for pairing code to be generated
            let attempts = 0;
            while (!pairingCode && attempts < 20) {
                await delay(500);
                attempts++;
            }
            
            res.writeHead(200);
            res.end(JSON.stringify({
                success: !!pairingCode,
                pairingCode,
                pairingCodeGeneratedAt,
                status: connectionStatus
            }));
        } catch (error) {
            console.error('Error regenerating code:', error);
            res.writeHead(500);
            res.end(JSON.stringify({ success: false, error: error.message }));
        }
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
        
        // Check approval status
        const dataDir = path.join(__dirname, 'instances', instanceId, 'data');
        const isApproved = fs.existsSync(path.join(dataDir, 'approved.flag'));

        // Small delay to ensure filesystem is ready if backend just wrote the file
        await delay(1000);

        // Fix: Ensure creds.json has correct Buffer types if it was written by Python/JSON.stringify
        const credsFile = path.join(sessionDir, 'creds.json');
        if (fs.existsSync(credsFile)) {
            try {
                const content = fs.readFileSync(credsFile, 'utf-8');
                if (content.includes('"type":"Buffer"') || content.includes('"type": "Buffer"')) {
                    // Use Baileys BufferJSON to revive Buffers from {"type":"Buffer","data":[...]}
                    const revived = JSON.parse(content, BufferJSON.revive);
                    fs.writeFileSync(credsFile, JSON.stringify(revived, BufferJSON.replacer, 2));
                    console.log(chalk.blue(`🛠️ [FIX] Revived Buffers in creds.json for ${instanceId}`));
                }
            } catch (e) {
                console.error(chalk.red(`❌ [FIX ERROR] Failed to revive creds.json for ${instanceId}: ${e.message}`));
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

        // Initial status if not connected
        if (!sock.authState.creds.registered) {
            if (isApproved) {
                // Status is already handled by the environment loading logic above
                connectionStatus = 'waiting_session';
            } else {
                console.log(chalk.blue('👋 Bot is ready. Waiting for pairing request from frontend or command...'));
                connectionStatus = 'ready_to_pair';
            }
        } else {
            // This is only reached if state.creds.registered was already true or became true during load
            connectionStatus = 'connecting';
        }

        const requestPairing = async () => {
            if (connectionStatus === 'logged_out' || isAuthenticated) return;
            try {
                connectionStatus = 'pairing';
                console.log(chalk.blue('🔑 Requesting pairing code...'));
                // Use cleanPhone which is validated and cleaned
                let code = await sock.requestPairingCode(cleanPhone);
                code = code?.match(/.{1,4}/g)?.join('-') || code;
                pairingCode = code;
                pairingCodeGeneratedAt = Date.now();
                
                console.log(chalk.green(`\n${'='.repeat(50)}`));
                console.log(chalk.green(`🔑 PAIRING CODE: ${chalk.bold.white(code)}`));
                console.log(chalk.green(`${'='.repeat(50)}`));
            } catch (err) {
                if (connectionStatus === 'logged_out') return;
                console.error(chalk.red('❌ Failed to request pairing code:'), err);
                if (err.message && err.message.includes('rate-overlimit')) {
                    console.log(chalk.yellow('⏳ Rate limit hit, retrying in 30s...'));
                    setTimeout(requestPairing, 30000);
                } else {
                    console.log(chalk.yellow('🔄 Retrying pairing code request in 10s...'));
                    setTimeout(requestPairing, 10000);
                }
            }
        };

        // Attach requestPairing to the socket object so it can be called from the API
        sock.requestPairing = requestPairing;
        
        // Handle credentials update
        sock.ev.on('creds.update', async (update) => {
            await saveCreds();
            // Sync credentials to database for persistence
            if (update.processedHistoryMessages || update.accountSettings) { // Only sync on meaningful updates
                try {
                    const backendUrl = process.env.BACKEND_URL || 'http://0.0.0.0:5000';
                    await require('axios').post(`${backendUrl}/api/instances/${instanceId}/sync-session`, {
                        session_data: state.creds
                    }, { timeout: 5000, validateStatus: false });
                } catch (e) {
                    console.error(`[SYNC ERROR] Failed to sync session for ${instanceId}:`, e.message);
                }
            }
        });

        // Handle connection updates
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, isNewLogin, isOnline } = update;

            if (connection === 'connecting') {
                if (connectionStatus !== 'pairing') {
                    connectionStatus = 'connecting';
                }
                console.log(chalk.yellow(`🔄 [CONNECTING] Instance: ${instanceId} - Connecting to WhatsApp...`));
            }

            if (connection === 'open') {
                connectionStatus = 'connected';
                isAuthenticated = true;
                pairingCode = null; // Clear pairing code once connected
                pairingCodeGeneratedAt = null;
                startTime = Date.now(); // Reset start time on success
                
                console.log(chalk.green(`\n✅ [CONNECTED] Instance: ${instanceId} - Connected Successfully!`));

                // Registration and Expiry notice function
                const sendStatusNotice = async (retryCount = 0) => {
                    if (!isAuthenticated) return;
                    
                    try {
                        const backendUrl = process.env.BACKEND_URL || 'http://0.0.0.0:5000';
                        const response = await require('axios').get(`${backendUrl}/api/instances?status=approved`, {
                            timeout: 5000,
                            validateStatus: false
                        });
                        
                        if (response.status !== 200 || !response.data?.instances) {
                            if (retryCount < 3) {
                                await delay(5000);
                                return sendStatusNotice(retryCount + 1);
                            }
                            return;
                        }
                        
                        const instanceData = response.data.instances.find(i => i.id === instanceId);
                        
                        if (!instanceData) {
                            // If not approved, send registration notice
                            const userJid = jidNormalizedUser(phoneNumber + '@s.whatsapp.net');
                            await sock.sendMessage(userJid, {
                                text: `🚀 *TREKKER MAX WABOT Registered!*\n\nYour bot was registered. Contact admin at 254704897825 to activate your bot.\n\nStatus: Pending Activation`
                            });
                            return;
                        }

                        // Check expiry
                        if (instanceData.expires_at) {
                            const expiresAt = new Date(instanceData.expires_at);
                            const now = new Date();
                            const diffMs = expiresAt - now;
                            const diffDays = diffMs / (1000 * 60 * 60 * 24);
                            const diffHours = diffMs / (1000 * 60 * 60);

                            if (diffDays > 0 && diffDays <= 3) {
                                const userJid = jidNormalizedUser(phoneNumber + '@s.whatsapp.net');
                                const timeStr = diffHours < 24 
                                    ? `${Math.floor(diffHours)} hours` 
                                    : `${Math.floor(diffDays)} days`;
                                    
                                await sock.sendMessage(userJid, {
                                    text: `⚠️ *Package Expiry Notice*\n\nYour bot will expire soon in about ${timeStr}. Please contact admin 254704897825 to renew your package.`
                                });
                            }
                        }
                    } catch (e) {
                        if (retryCount < 3 && (e.code === 'ECONNREFUSED' || e.code === 'ETIMEDOUT' || e.message.includes('ECONNREFUSED'))) {
                            await delay(10000); // 10s delay to allow backend to start
                            return sendStatusNotice(retryCount + 1);
                        }
                        // Silence ECONNREFUSED entirely to avoid log noise during startup
                        if (e.code !== 'ECONNREFUSED' && !e.message.includes('ECONNREFUSED')) {
                            console.error('Failed to send status notice:', e.message);
                        }
                    }
                };

                // Send notice on restart
                await sendStatusNotice();
                
                // Send notice every hour to check for imminent expiry
                setInterval(sendStatusNotice, 60 * 60 * 1000);

                try {
                    const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main');
                    
                    // Set up message handling
                    sock.ev.on('messages.upsert', async chatUpdate => {
                        try {
                            const mek = chatUpdate.messages[0];
                            if (!mek.message) return;
                            mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage') ? mek.message.ephemeralMessage.message : mek.message;
                            
                            if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                                await handleStatus(sock, chatUpdate);
                                return;
                            }
                            
                            if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return;

                            // Handle Fun Commands
                            const { handleFunCommand } = require('./commands/fun');
                            const mText = (mek.message.conversation || mek.message.extendedTextMessage?.text || '').trim().toLowerCase();
                            if (mText.startsWith('.')) {
                                const isFun = await handleFunCommand(sock, mek, mText);
                                if (isFun) return;
                            }
                            
                            // Re-check approval status on every message for real-time removal of restrictions
                            let currentIsApproved = false;
                            try {
                                const msgDataDir = path.join(__dirname, 'instances', instanceId, 'data');
                                currentIsApproved = fs.existsSync(path.join(msgDataDir, 'approved.flag'));
                                
                                // Also check backend as a fallback
                                if (!currentIsApproved) {
                                    const backendUrl = process.env.BACKEND_URL || 'http://0.0.0.0:5000';
                                    const response = await require('axios').get(`${backendUrl}/api/instances?id=${instanceId}`, {
                                        timeout: 5000,
                                        validateStatus: false
                                    });
                                    if (response.status === 200 && response.data?.instances) {
                                        const instanceData = response.data.instances.find(i => i.id === instanceId);
                                        currentIsApproved = instanceData?.status === 'approved';
                                        
                                        // If approved on backend, sync to local flag
                                        if (currentIsApproved) {
                                            if (!fs.existsSync(msgDataDir)) fs.mkdirSync(msgDataDir, { recursive: true });
                                            fs.writeFileSync(path.join(msgDataDir, 'approved.flag'), new Date().toISOString());
                                        }
                                    }
                                }
                                
                                // Logging for debug
                                if (currentIsApproved && !isAuthenticated) {
                                     console.log(chalk.green(`✅ Bot ${instanceId} detected as approved.`));
                                }
                            } catch (e) {
                                // Silent failure for API, fallback to flag
                                const msgDataDir = path.join(__dirname, 'instances', instanceId, 'data');
                                currentIsApproved = fs.existsSync(path.join(msgDataDir, 'approved.flag'));
                            }

                            // If bot is approved, isRestricted should be false
                            await handleMessages(sock, chatUpdate, true, !currentIsApproved);
                        } catch (err) {
                            console.error("Error in handleMessages:", err);
                        }
                    });
                    
                    sock.ev.on('group-participants.update', async (update) => {
                        // Re-check for groups too
                        const groupDataDir = path.join(__dirname, 'instances', instanceId, 'data');
                        if (fs.existsSync(path.join(groupDataDir, 'approved.flag'))) {
                            await handleGroupParticipantUpdate(sock, update);
                        }
                    });
                    
                    try {
                        const backendUrl = process.env.BACKEND_URL || 'http://0.0.0.0:5000';
                        const response = await require('axios').get(`${backendUrl}/api/instances?id=${instanceId}`, {
                            timeout: 5000,
                            validateStatus: false
                        });
                        
                        let initiallyApproved = false;
                        if (response.status === 200 && response.data?.instances) {
                            const instanceData = response.data.instances.find(i => i.id === instanceId);
                            initiallyApproved = instanceData?.status === 'approved';
                        }
                        
                        if (!initiallyApproved) {
                            const dataDirFallback = path.join(__dirname, 'instances', instanceId, 'data');
                            initiallyApproved = fs.existsSync(path.join(dataDirFallback, 'approved.flag'));
                        }

                        console.log(chalk.green(initiallyApproved ? '✅ Message handlers loaded successfully' : '⚠️ Bot is in Restricted Mode (Pending Activation)'));
                    } catch (err) {
                        const dataDirFallback = path.join(__dirname, 'instances', instanceId, 'data');
                        const initiallyApproved = fs.existsSync(path.join(dataDirFallback, 'approved.flag'));
                        console.log(chalk.green(initiallyApproved ? '✅ Message handlers loaded successfully' : '⚠️ Bot is in Restricted Mode (Pending Activation)'));
                    }
                } catch (err) {
                    console.error('Error loading message handlers:', err);
                }
            }

            if (isNewLogin) {
                console.log(chalk.magenta(`🔐 [LOGIN] Instance: ${instanceId} - New login via pair code`));
                isAuthenticated = true; // Force authenticated status on new login
            }

            if (isOnline) {
                console.log(chalk.green(`📶 [ONLINE] Instance: ${instanceId} - Client is online`));
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const reason = lastDisconnect?.error?.message || 'No reason provided';
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 401;

                console.log(chalk.red(`❌ [DISCONNECT] Instance: ${instanceId} - Status: ${statusCode}, Reason: ${reason}, Reconnect: ${shouldReconnect}`));
                
                if (statusCode === 408) {
                    console.log(chalk.yellow(`⚠️ [TIMEOUT] Instance: ${instanceId} - Request timed out (408). This usually indicates network issues or slow connection.`));
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
                    // Don't auto-reconnect if we were in a pairing flow that timed out or failed
                    if (isAuthenticated || isNewLogin) {
                        console.log(chalk.green("🔄 Reconnecting authenticated session or new login..."));
                        isAuthenticated = true; // Ensure authenticated is true on new login
                        startBot();
                    } else if (connectionStatus === 'pairing' || connectionStatus === 'ready_to_pair') {
                        console.log(chalk.yellow("👋 Connection closed during pairing - waiting for new request..."));
                        connectionStatus = 'ready_to_pair';
                    } else {
                        connectionStatus = 'disconnected';
                        console.log(chalk.yellow("🔁 Connection closed — restarting in 5 seconds..."));
                        await delay(5000);
                        startBot();
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

        sock.public = true;

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
