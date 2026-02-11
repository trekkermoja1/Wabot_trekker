const { Worker, isMainThread, workerData } = require('worker_threads');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

async function startStatusWorker() {
    // Dynamic import Baileys
    const { 
        default: makeWASocket, 
        useMultiFileAuthState, 
        fetchLatestBaileysVersion,
        DisconnectReason,
        makeCacheableSignalKeyStore
    } = await import("@whiskeysockets/baileys");

    const { state, saveCreds } = await useMultiFileAuthState(workerData.authPath);
    const { version } = await fetchLatestBaileysVersion();

    console.log(`[STATUS WORKER] Starting for ${workerData.authPath}`);

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
        },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['Status-Worker', 'Safari', '1.0.0'],
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('[STATUS WORKER] Connection closed. Reconnecting...', shouldReconnect);
            if (shouldReconnect) {
                setTimeout(startStatusWorker, 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ [STATUS WORKER] Connected and monitoring statuses');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        for (const msg of m.messages) {
            if (msg.key.remoteJid === 'status@broadcast') {
                console.log(`✨ [STATUS WORKER] Status detected from: ${msg.key.participant || msg.key.remoteJid}`);
                try {
                    // Auto-view by reading the message
                    await sock.readMessages([msg.key]);
                    console.log(`✅ [STATUS WORKER] Status viewed successfully`);
                } catch (err) {
                    // Ignore errors for already read messages or connection issues
                }
            }
        }
    });
}

if (!isMainThread) {
    startStatusWorker().catch(err => {
        console.error('[STATUS WORKER] Fatal Error:', err);
    });
}
