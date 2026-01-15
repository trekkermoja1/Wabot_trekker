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
let makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, jidDecode, proto, jidNormalizedUser, makeCacheableSignalKeyStore, delay, Browsers;

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
        console.log(chalk.blue(`📱 Pairing code request for ${instanceId}. Current code: ${pairingCode}, Status: ${connectionStatus}`));
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
        
        // Ensure Baileys is loaded
    if (!makeWASocket) {
        await loadBaileys();
    }
    
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        
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

        // Request pairing code if not connected
        if (!sock.authState.creds.registered) {
            console.log(chalk.blue('🔑 Requesting pairing code...'));
            connectionStatus = 'pairing';
            
            const requestPairing = async () => {
                try {
                    // Use cleanPhone which is validated and cleaned
                    let code = await sock.requestPairingCode(cleanPhone);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    pairingCode = code;
                    pairingCodeGeneratedAt = Date.now();
                    
                    console.log(chalk.green(`\n${'='.repeat(50)}`));
                    console.log(chalk.green(`🔑 PAIRING CODE: ${chalk.bold.white(code)}`));
                    console.log(chalk.green(`${'='.repeat(50)}`));
                } catch (err) {
                    console.error(chalk.red('❌ Failed to request pairing code:'), err);
                    if (err.message.includes('rate-overlimit')) {
                        console.log(chalk.yellow('⏳ Rate limit hit, retrying in 30s...'));
                        setTimeout(requestPairing, 30000);
                    } else {
                        // Don't set error status immediately, retry a few times
                        console.log(chalk.yellow('🔄 Retrying pairing code request in 10s...'));
                        setTimeout(requestPairing, 10000);
                    }
                }
            };
            setTimeout(requestPairing, 5000);
        }
        
        // Handle credentials update
        sock.ev.on('creds.update', saveCreds);

        // Handle connection updates
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, isNewLogin, isOnline } = update;

            if (connection === 'connecting') {
                if (connectionStatus !== 'pairing') {
                    connectionStatus = 'connecting';
                }
                console.log(chalk.yellow('🔄 Connecting to WhatsApp...'));
            }

            if (connection === 'open') {
                connectionStatus = 'connected';
                isAuthenticated = true;
                pairingCode = null; // Clear pairing code once connected
                pairingCodeGeneratedAt = null;
                
                console.log(chalk.green(`\n✅ TREKKER MAX WABOT Connected Successfully!`));
                console.log(chalk.cyan(`👤 User: ${JSON.stringify(sock.user, null, 2)}`));

                try {
                    const userJid = jidNormalizedUser(cleanPhone + '@s.whatsapp.net');
                    
                    // Send success message to user
                    await sock.sendMessage(userJid, {
                        text: `🚀 *TREKKER MAX WABOT Connected!*\n\n✅ Instance: ${instanceId}\n⏰ Time: ${new Date().toLocaleString()}\n📱 Status: Online and Ready!\n\nYour bot is now active. Use .help or .menu to see available commands.`
                    });
                    
                    console.log(chalk.green('📤 Welcome message sent to user'));
                    
                    // Load message handlers after successful connection
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
                                
                                await handleMessages(sock, chatUpdate, true);
                            } catch (err) {
                                console.error("Error in handleMessages:", err);
                            }
                        });
                        
                        sock.ev.on('group-participants.update', async (update) => {
                            await handleGroupParticipantUpdate(sock, update);
                        });
                        
                        console.log(chalk.green('✅ Message handlers loaded successfully'));
                    } catch (err) {
                        console.error('Error loading message handlers:', err);
                    }
                    
                } catch (error) {
                    console.error("❌ Error sending welcome message:", error);
                }
            }

            if (isNewLogin) {
                console.log(chalk.magenta("🔐 New login via pair code"));
            }

            if (isOnline) {
                console.log(chalk.green("📶 Client is online"));
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 401;

                console.log(chalk.red(`Connection closed - Status: ${statusCode}, Reconnect: ${shouldReconnect}`));
                connectionStatus = 'disconnected';

                if (statusCode === 401 || statusCode === DisconnectReason.loggedOut) {
                    console.log(chalk.yellow("❌ Logged out from WhatsApp. Need to generate new pair code."));
                    isAuthenticated = false;
                    pairingCode = null;
                    
                    // Clear session
                    removeFile(sessionDir);
                    fs.mkdirSync(sessionDir, { recursive: true });
                    connectionStatus = 'logged_out';
                } else if (shouldReconnect) {
                    console.log(chalk.yellow("🔁 Connection closed — restarting in 5 seconds..."));
                    await delay(5000);
                    startBot();
                }
            }
        });

        } else {
            console.log(chalk.green('✅ Already registered, connecting...'));
            connectionStatus = 'connecting';
        }

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
