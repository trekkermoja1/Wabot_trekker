/**
 * Knight Bot - A WhatsApp Bot
 * Copyright (c) 2024 Professor
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 * 
 * Credits:
 * - Baileys Library by @adiwajshing
 * - Pair Code implementation inspired by TechGod143 & DGXEON
 */
require('./settings')
const { Boom } = require('@hapi/boom')
const fs = require('fs')
const chalk = require('chalk')
const FileType = require('file-type')
const path = require('path')
const axios = require('axios')
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('../main');
const PhoneNumber = require('awesome-phonenumber')
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('./lib/exif')
const { smsg, isUrl, generateMessageTag, getBuffer, getSizeMedia, fetch, await, sleep, reSize } = require('./lib/myfunc')
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    generateForwardMessageContent,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    generateMessageID,
    downloadContentFromMessage,
    jidDecode,
    proto,
    jidNormalizedUser,
    makeCacheableSignalKeyStore,
    delay
} = require("@whiskeysockets/baileys")
const NodeCache = require("node-cache")
// Using a lightweight persisted store instead of makeInMemoryStore (compat across versions)
const pino = require("pino")
const readline = require("readline")
const { parsePhoneNumber } = require("libphonenumber-js")
const { PHONENUMBER_MCC } = require('@whiskeysockets/baileys/lib/Utils/generics')
const { rmSync, existsSync } = require('fs')
const { join } = require('path')

// Import lightweight store
const store = require('./lib/lightweight_store')

// Import status cache manager
const statusCache = require('./lib/statusCache')

// Read session data from environment variable if provided
const sessionDataFromEnv = process.env.SESSION_DATA;
const instanceId = process.argv[2] || 'default';
const DATABASE_URL = process.env.DATABASE_URL;

let dbPool;
if (DATABASE_URL) {
    dbPool = new (require('pg').Pool)({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
}
const sessionDir = path.join(__dirname, 'instances', instanceId, 'session');

/**
 * Flag bot as offline in database via API (with caching to avoid repetitive updates)
 */
async function flagBotOffline() {
    try {
        // Check if we should update DB (only if not recently cached)
        if (!statusCache.shouldUpdateDB(instanceId)) {
            console.log(chalk.gray(`[${instanceId}] ⏭️  Offline status already cached, skipping DB update`));
            return;
        }
        
        // Mark in cache to prevent repeated DB calls
        statusCache.markBotStatus(instanceId, 'offline');
        
        // Try to notify backend if available
        const backendPort = process.env.BACKEND_PORT || 5000;
        const backendUrl = `http://127.0.0.1:${backendPort}/api/bot/${instanceId}/offline`;
        
        try {
            await axios.post(backendUrl, {}, { timeout: 3000 });
            console.log(chalk.yellow(`[${instanceId}] 📡 Flagged as offline in database`));
        } catch (error) {
            // If API call fails, it's OK - cache will prevent repeated attempts
            console.log(chalk.gray(`[${instanceId}] Note: Backend update unavailable, using cache`));
        }
    } catch (error) {
        console.error(`[${instanceId}] Error flagging offline:`, error.message);
    }
}

if (sessionDataFromEnv) {
    try {
        // Clean old session first
        if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
        }
        fs.mkdirSync(sessionDir, { recursive: true });
        
        // Write session data directly - it's already in correct format from DB
        fs.writeFileSync(path.join(sessionDir, 'creds.json'), sessionDataFromEnv);
        console.log('💾 Session restored from DB to', sessionDir);
    } catch (e) {
        console.error('Error restoring session from env:', e.message, e.stack);
    }
}

// Initialize store
store.readFromFile()
const settings = require('./settings')
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000)

// Periodic check for sending startup message every 10 minutes
let XeonBotIncRef = null;
function setXeonBotRef(sock) {
    XeonBotIncRef = sock;
}

setInterval(async () => {
    if (XeonBotIncRef && XeonBotIncRef?.user) {
        await sendStartupMessage(XeonBotIncRef).catch(() => {});
    }
}, 10 * 60 * 1000); // every 10 minutes

// Memory optimization - Force garbage collection if available
setInterval(() => {
    if (global.gc) {
        global.gc()
        console.log('🧹 Garbage collection completed')
    }
}, 60_000) // every 1 minute

// Memory monitoring - Restart if RAM gets too high
setInterval(() => {
    const used = process.memoryUsage().rss / 1024 / 1024
    if (used > 400) {
        console.log('⚠️ RAM too high (>400MB), restarting bot...')
        process.exit(1) // Panel will auto-restart
    }
}, 30_000) // check every 30 seconds

// Connection retry tracking
let connectionAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
let reconnectDelay = 5000;

// Uptime tracking - save to file for persistence across restarts
const UPTIME_FILE = path.join(__dirname, 'data', 'uptime.json');
let startTime = Date.now();
let lastStartupMessageSent = 0;

async function initDbStartupMsg() {
    if (!dbPool) return;
    try {
        await dbPool.query(
            'ALTER TABLE bot_instances ADD COLUMN IF NOT EXISTS last_startup_message_sent BIGINT DEFAULT 0'
        );
    } catch (e) {
        console.error('Error initializing startup msg column:', e.message);
    }
}

async function getLastStartupMsgTime() {
    if (!dbPool) return 0;
    try {
        const result = await dbPool.query(
            'SELECT last_startup_message_sent FROM bot_instances WHERE id = $1',
            [instanceId]
        );
        return result.rows.length > 0 ? result.rows[0].last_startup_message_sent : 0;
    } catch (e) {
        console.error('Error reading startup msg from DB:', e.message);
        return 0;
    }
}

async function saveLastStartupMsgTime(time) {
    if (!dbPool) return;
    try {
        await dbPool.query(
            'UPDATE bot_instances SET last_startup_message_sent = $1 WHERE id = $2',
            [time, instanceId]
        );
    } catch (e) {
        console.error('Error saving startup msg to DB:', e.message);
    }
}

function getSavedStartTime() {
    try {
        if (fs.existsSync(UPTIME_FILE)) {
            const data = JSON.parse(fs.readFileSync(UPTIME_FILE, 'utf8'));
            return data.startTime || null;
        }
    } catch (e) {
        console.error('Error reading uptime file:', e.message);
    }
    return null;
}

function saveStartTime() {
    try {
        const dataDir = path.dirname(UPTIME_FILE);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        fs.writeFileSync(UPTIME_FILE, JSON.stringify({ startTime }, null, 2));
    } catch (e) {
        console.error('Error writing uptime file:', e.message);
    }
}

// Initialize startTime - restore from file or create new
const savedStartTime = getSavedStartTime();
if (savedStartTime) {
    startTime = savedStartTime;
} else {
    saveStartTime();
}

// Initialize from DB (async)
let dbInitPromise;
async function initStartupMsgFromDb() {
    await initDbStartupMsg();
    lastStartupMessageSent = await getLastStartupMsgTime();
}

dbInitPromise = initStartupMsgFromDb();

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

// Send startup message with uptime every 2 hours
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

async function sendStartupMessage(sock) {
    await dbInitPromise;
    
    const now = Date.now();
    const timeSinceLastSent = now - lastStartupMessageSent;
    
    if (lastStartupMessageSent > 0 && timeSinceLastSent < TWO_HOURS_MS) {
        const hoursLeft = Math.ceil((TWO_HOURS_MS - timeSinceLastSent) / (1000 * 60 * 60));
        console.log(chalk.yellow(`⏭️ Startup message skipped (sent ${Math.floor(timeSinceLastSent / (1000 * 60))}min ago, next in ${hoursLeft}h)`));
        return;
    }
    
    try {
        const uptimeMs = now - startTime;
        const uptimeInSeconds = Math.floor(uptimeMs / 1000);
        const uptimeStr = formatUptime(uptimeInSeconds);
        
        const devSuffix = process.env.DEV_MODE === 'true' ? ' [DEV MODE]' : '';
        const botName = sock?.user?.name || sock?.user?.pushName || 'TREKKER-WABOT';
        
        const ownerJid = owner[0] + '@s.whatsapp.net';
        
        const message = `
┏━━〔 🤖 ${botName} 〕━━┓
┃ ✅ Status    : Online${devSuffix}
┃ ⏱️ Uptime   : ${uptimeStr}
┃ 📱 Bot      : ${phoneNumber || 'N/A'}
┗━━━━━━━━━━━━━━━━━━━┛

Use .help or .menu to manage the bot`.trim();
        
        await sock.sendMessage(ownerJid, { text: message });
        
        lastStartupMessageSent = now;
        await saveLastStartupMsgTime(now);
        console.log(chalk.green(`✅ Startup message sent to owner (uptime: ${uptimeStr})`));
    } catch (e) {
        console.error('Error sending startup message:', e.message);
    }
}

let phoneNumber = "911234567890"
let owner = JSON.parse(fs.readFileSync('./data/owner.json'))

global.botname = "TREKKER-WABOT"
global.themeemoji = "•"
const pairingCode = !!phoneNumber || process.argv.includes("--pairing-code")
const useMobile = process.argv.includes("--mobile")

// Only create readline interface if we're in an interactive environment
const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null
const question = (text) => {
    if (rl) {
        return new Promise((resolve) => rl.question(text, resolve))
    } else {
        // In non-interactive environment, use ownerNumber from settings
        return Promise.resolve(settings.ownerNumber || phoneNumber)
    }
}


async function startXeonBotInc() {
    try {
        let { version, isLatest } = await fetchLatestBaileysVersion()
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir)
        const msgRetryCounterCache = new NodeCache()

        const XeonBotInc = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: !pairingCode,
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            getMessage: async (key) => {
                let jid = jidNormalizedUser(key.remoteJid)
                let msg = await store.loadMessage(jid, key.id)
                return msg?.message || ""
            },
            msgRetryCounterCache,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
        })

        // Store reference for periodic startup message
        setXeonBotRef(XeonBotInc);

        // Save credentials when they update
        XeonBotInc.ev.on('creds.update', saveCreds)

    store.bind(XeonBotInc.ev)

    // Message handling
    XeonBotInc.ev.on('messages.upsert', async chatUpdate => {
        try {
            const mek = chatUpdate.messages[0]
            if (!mek.message) return
            mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage') ? mek.message.ephemeralMessage.message : mek.message
            if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                await handleStatus(XeonBotInc, chatUpdate);
                return;
            }
            // In private mode, only block non-group messages (allow groups for moderation)
            // Note: XeonBotInc.public is not synced, so we check mode in main.js instead
            // This check is kept for backward compatibility but mainly blocks DMs
            if (!XeonBotInc.public && !mek.key.fromMe && chatUpdate.type === 'notify') {
                const isGroup = mek.key?.remoteJid?.endsWith('@g.us')
                if (!isGroup) return // Block DMs in private mode, but allow group messages
            }
            if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return

            // Clear message retry cache to prevent memory bloat
            if (XeonBotInc?.msgRetryCounterCache) {
                XeonBotInc.msgRetryCounterCache.clear()
            }

            try {
                await handleMessages(XeonBotInc, chatUpdate, true)
            } catch (err) {
                console.error("Error in handleMessages:", err)
                // Only try to send error message if we have a valid chatId
                if (mek.key && mek.key.remoteJid) {
                    await XeonBotInc.sendMessage(mek.key.remoteJid, {
                        text: '❌ An error occurred while processing your message.',
                        contextInfo: {
                            forwardingScore: 1,
                            isForwarded: true,
                            forwardedNewsletterMessageInfo: {
                                newsletterJid: '120363421057570812@newsletter',
                                newsletterName: 'TREKKER-WABOT',
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

    // Add these event handlers for better functionality
    XeonBotInc.decodeJid = (jid) => {
        if (!jid) return jid
        if (/:\d+@/gi.test(jid)) {
            let decode = jidDecode(jid) || {}
            return decode.user && decode.server && decode.user + '@' + decode.server || jid
        } else return jid
    }

    XeonBotInc.ev.on('contacts.update', update => {
        for (let contact of update) {
            let id = XeonBotInc.decodeJid(contact.id)
            if (store && store.contacts) store.contacts[id] = { id, name: contact.notify }
        }
    })

    XeonBotInc.getName = (jid, withoutContact = false) => {
        id = XeonBotInc.decodeJid(jid)
        withoutContact = XeonBotInc.withoutContact || withoutContact
        let v
        if (id.endsWith("@g.us")) return new Promise(async (resolve) => {
            v = store.contacts[id] || {}
            if (!(v.name || v.subject)) v = XeonBotInc.groupMetadata(id) || {}
            resolve(v.name || v.subject || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international'))
        })
        else v = id === '0@s.whatsapp.net' ? {
            id,
            name: 'WhatsApp'
        } : id === XeonBotInc.decodeJid(XeonBotInc.user.id) ?
            XeonBotInc.user :
            (store.contacts[id] || {})
        return (withoutContact ? '' : v.name) || v.subject || v.verifiedName || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international')
    }

    XeonBotInc.public = true

    XeonBotInc.serializeM = (m) => smsg(XeonBotInc, m, store)

    // Handle pairing code
    if (pairingCode && !XeonBotInc.authState.creds.registered) {
        if (useMobile) throw new Error('Cannot use pairing code with mobile api')

        let phoneNumber
        if (!!global.phoneNumber) {
            phoneNumber = global.phoneNumber
        } else {
            phoneNumber = await question(chalk.bgBlack(chalk.greenBright(`Please type your WhatsApp number 😍\nFormat: 6281376552730 (without + or spaces) : `)))
        }

        // Clean the phone number - remove any non-digit characters
        phoneNumber = phoneNumber.replace(/[^0-9]/g, '')

        // Validate the phone number using awesome-phonenumber
        const pn = require('awesome-phonenumber');
        if (!pn('+' + phoneNumber).isValid()) {
            console.log(chalk.red('Invalid phone number. Please enter your full international number (e.g., 15551234567 for US, 447911123456 for UK, etc.) without + or spaces.'));
            process.exit(1);
        }

        setTimeout(async () => {
            try {
                let code = await XeonBotInc.requestPairingCode(phoneNumber)
                code = code?.match(/.{1,4}/g)?.join("-") || code
                console.log(chalk.black(chalk.bgGreen(`Your Pairing Code : `)), chalk.black(chalk.white(code)))
                console.log(chalk.yellow(`\nPlease enter this code in your WhatsApp app:\n1. Open WhatsApp\n2. Go to Settings > Linked Devices\n3. Tap "Link a Device"\n4. Enter the code shown above`))
            } catch (error) {
                console.error('Error requesting pairing code:', error)
                console.log(chalk.red('Failed to get pairing code. Please check your phone number and try again.'))
            }
        }, 3000)
    }

    // Connection handling
    XeonBotInc.ev.on('connection.update', async (s) => {
        const { connection, lastDisconnect, qr } = s
        
        if (qr) {
            console.log(chalk.yellow('📱 QR Code generated. Please scan with WhatsApp.'))
        }
        
        if (connection === 'connecting') {
            console.log(chalk.yellow('🔄 Connecting to WhatsApp...'))
        }
        
        if (connection == "open") {
            console.log(chalk.magenta(` `))
            console.log(chalk.yellow(`🌿Connected to => ` + JSON.stringify(XeonBotInc.user, null, 2)))

            try {
                const botNumber = XeonBotInc.user.id.split(':')[0] + '@s.whatsapp.net';
                await XeonBotInc.sendMessage(botNumber, {
                    text: `🤖 Bot Connected Successfully!\n\n⏰ Time: ${new Date().toLocaleString()}\n✅ Status: Online and Ready!\n\n✅Make sure to join below channel`,
                    contextInfo: {
                        forwardingScore: 1,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: '120363421057570812@newsletter',
                            newsletterName: 'TREKKER-WABOT',
                            serverMessageId: -1
                        }
                    }
                });
            } catch (error) {
                console.error('Error sending connection message:', error.message)
            }

            await delay(1999)
            console.log(chalk.yellow(`\n\n                  ${chalk.bold.blue(`[ ${global.botname || 'TREKKER-WABOT'} ]`)}\n\n`))
            console.log(chalk.cyan(`< ================================================== >`))
            console.log(chalk.magenta(`\n${global.themeemoji || '•'} YT CHANNEL: MR UNIQUE HACKER`))
            console.log(chalk.magenta(`${global.themeemoji || '•'} GITHUB: mrunqiuehacker`))
            console.log(chalk.magenta(`${global.themeemoji || '•'} WA NUMBER: ${owner}`))
            console.log(chalk.magenta(`${global.themeemoji || '•'} CREDIT: MR UNIQUE HACKER`))
            console.log(chalk.green(`${global.themeemoji || '•'} 🤖 Bot Connected Successfully! ✅`))
            console.log(chalk.blue(`Bot Version: ${settings.version}`))
        }
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 401;
            
            console.log(chalk.red(`[${instanceId}] Connection closed due to ${lastDisconnect?.error}, reconnecting ${shouldReconnect}`));
            
            // Flag bot as offline (with cache optimization)
            flagBotOffline().catch(e => console.error(`[${instanceId}] Offline flag error:`, e.message));
            
            connectionAttempts++;
            
            // Check if we should stop reconnecting
            if (connectionAttempts >= MAX_RECONNECT_ATTEMPTS) {
                console.log(chalk.red(`[${instanceId}] ❌ Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Exiting...`));
                process.exit(1);
            }
            
            // Exponential backoff: 5s, 10s, 20s, 40s, 80s...
            reconnectDelay = Math.min(reconnectDelay * 2, 60000);
            console.log(chalk.yellow(`[${instanceId}] Reconnecting in ${reconnectDelay/1000}s (attempt ${connectionAttempts}/${MAX_RECONNECT_ATTEMPTS})...`));
            
            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                try {
                    rmSync(sessionDir, { recursive: true, force: true });
                    console.log(chalk.yellow(`[${instanceId}] Session deleted - will retry with fresh session...`));
                } catch (error) {
                    console.error(`[${instanceId}] Error deleting session:`, error);
                }
            }
            
            await delay(reconnectDelay);
            startXeonBotInc();
            return;
        }
        
        if (connection === 'open') {
            // Reset connection attempts on successful connect
            connectionAttempts = 0;
            reconnectDelay = 5000;
            console.log(chalk.green('✅ Connected to WhatsApp'));
            
            // Clear offline cache on successful reconnect
            statusCache.clearBotCache(instanceId);
            
            // Send startup message with uptime
            sendStartupMessage(XeonBotInc).catch(e => console.error('Startup message error:', e.message));
        }
    })

    // Track recently-notified callers to avoid spamming messages
    const antiCallNotified = new Set();

    // Anticall handler: block callers when enabled
    XeonBotInc.ev.on('call', async (calls) => {
        try {
            const { readState: readAnticallState } = require('./commands/anticall');
            const state = readAnticallState();
            if (!state.enabled) return;
            for (const call of calls) {
                const callerJid = call.from || call.peerJid || call.chatId;
                if (!callerJid) continue;
                try {
                    // First: attempt to reject the call if supported
                    try {
                        if (typeof XeonBotInc.rejectCall === 'function' && call.id) {
                            await XeonBotInc.rejectCall(call.id, callerJid);
                        } else if (typeof XeonBotInc.sendCallOfferAck === 'function' && call.id) {
                            await XeonBotInc.sendCallOfferAck(call.id, callerJid, 'reject');
                        }
                    } catch {}

                    // Notify the caller only once within a short window
                    if (!antiCallNotified.has(callerJid)) {
                        antiCallNotified.add(callerJid);
                        setTimeout(() => antiCallNotified.delete(callerJid), 60000);
                        await XeonBotInc.sendMessage(callerJid, { text: '📵 Anticall is enabled. Your call was rejected and you will be blocked.' });
                    }
                } catch {}
                // Then: block after a short delay to ensure rejection and message are processed
                setTimeout(async () => {
                    try { await XeonBotInc.updateBlockStatus(callerJid, 'block'); } catch {}
                }, 800);
            }
        } catch (e) {
            // ignore
        }
    });

    XeonBotInc.ev.on('group-participants.update', async (update) => {
        await handleGroupParticipantUpdate(XeonBotInc, update);
    });

    XeonBotInc.ev.on('messages.upsert', async (m) => {
        if (m.messages[0].key && m.messages[0].key.remoteJid === 'status@broadcast') {
            await handleStatus(XeonBotInc, m);
        }
    });

    XeonBotInc.ev.on('status.update', async (status) => {
        await handleStatus(XeonBotInc, status);
    });

    XeonBotInc.ev.on('messages.reaction', async (status) => {
        await handleStatus(XeonBotInc, status);
    });

    return XeonBotInc
    } catch (error) {
        console.error('Error in startXeonBotInc:', error)
        await delay(5000)
        startXeonBotInc()
    }
}


// Start the bot with error handling
startXeonBotInc().catch(error => {
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
