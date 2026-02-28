import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';
import axios from 'axios';

const router = express.Router();

function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {
        console.error('Error removing file:', e);
    }
}

router.get('/', async (req, res) => {
    let num = req.query.number || '';
    let instanceId = req.query.instanceId || 'temp';
    
    // Use absolute paths
    const baseDir = '/home/runner/workspace/bot';
    let dirs = `${baseDir}/instances/${instanceId}/pairing_session`;
    let botSessionDir = `${baseDir}/instances/${instanceId}/session`;

    // Remove existing session if present
    await removeFile(dirs);

    // Ensure directories exist
    fs.mkdirSync(dirs, { recursive: true });
    fs.mkdirSync(botSessionDir, { recursive: true });

    // Clean the phone number - remove any non-digit characters
    if (!num) {
        return res.status(400).send({ code: 'Phone number is required' });
    }
    num = num.replace(/[^0-9]/g, '');

    // Validate the phone number using a simple check if awesome-phonenumber fails
    let isValid = false;
    let formattedNum = num;
    try {
        const phone = pn('+' + num);
        isValid = typeof phone.isValid === 'function' ? phone.isValid() : (phone.valid || false);
        if (isValid) {
            formattedNum = phone.getNumber('e164').replace('+', '');
        }
    } catch (e) {
        console.error('Phone validation error:', e);
        isValid = num.length >= 10; // Fallback
    }

    if (!isValid) {
        if (!res.headersSent) {
            return res.status(400).send({ code: 'Invalid phone number. Please enter your full international number without + or spaces.' });
        }
        return;
    }
    num = formattedNum;

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version, isLatest } = await fetchLatestBaileysVersion();
            let KnightBot = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.windows('Chrome'),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5,
            });

            let pairingComplete = false;

            KnightBot.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, isNewLogin, isOnline } = update;

                if (connection === 'open' && !pairingComplete) {
                    pairingComplete = true;
                    console.log("✅ Connected successfully!");
                    
                    try {
                        // Copy session files to bot's session directory
                        const files = fs.readdirSync(dirs);
                        for (const file of files) {
                            const src = `${dirs}/${file}`;
                            const dest = `${botSessionDir}/${file}`;
                            fs.copyFileSync(src, dest);
                        }
                        console.log("📁 Session files copied to bot directory");

                        // Send session file to user
                        const sessionKnight = fs.readFileSync(dirs + '/creds.json');
                        const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
                        await KnightBot.sendMessage(userJid, {
                            document: sessionKnight,
                            mimetype: 'application/json',
                            fileName: 'creds.json'
                        });
                        console.log("📤 Session file sent to user");

                        // Send success message
                        await KnightBot.sendMessage(userJid, {
                            text: `✅ *Pairing Successful!*

Your bot is now connected. It will start automatically.

⚠️ Do not share your session file with anybody!
`
                        });

                        // Notify backend to start the bot
                        try {
                            await axios.post('http://localhost:5000/api/instances/start-after-pairing', {
                                instanceId: instanceId,
                                phone_number: num
                            });
                            console.log("📡 Notified backend to start bot");
                        } catch (e) {
                            console.error("Failed to notify backend:", e.message);
                        }

                        // Clean up pairing session
                        await delay(2000);
                        removeFile(dirs);
                        console.log(`🧹 Pairing session cleaned up for ${instanceId}`);
                        
                        // Don't exit - stay running for other instances
                        console.log(`✅ Pairing complete for ${instanceId}. Waiting for next request...`);
                    } catch (error) {
                        console.error("❌ Error in pairing completion:", error);
                        // Don't exit - try to recover
                    }
                }

                if (isNewLogin) {
                    console.log("🔐 New login via pair code");
                }

                if (isOnline) {
                    console.log("📱 Client is online");
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;

                    if (statusCode === 401) {
                        console.log("❌ Logged out from WhatsApp. Need to generate new pair code.");
                    } else if (!pairingComplete) {
                        console.log("🔄 Connection closed — restarting...");
                        initiateSession();
                    }
                }
            });

            if (!KnightBot.authState.creds.registered) {
                await delay(3000);
                num = num.replace(/[^\d+]/g, '');
                if (num.startsWith('+')) num = num.substring(1);

                try {
                    let code = await KnightBot.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    if (!res.headersSent) {
                        console.log({ num, code });
                        await res.send({ code });
                    }
                } catch (error) {
                    console.error('Error requesting pairing code:', error);
                    if (!res.headersSent) {
                        res.status(503).send({ code: 'Failed to get pairing code. Please check your phone number and try again.' });
                    }
                }
            }

            KnightBot.ev.on('creds.update', saveCreds);
        } catch (err) {
            console.error('Error initializing session:', err);
            if (!res.headersSent) {
                res.status(503).send({ code: 'Service Unavailable' });
            }
        }
    }

    await initiateSession();
});

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
    if (e.includes("Stream Errored (restart required)")) return;
    if (e.includes("statusCode: 515")) return;
    if (e.includes("statusCode: 503")) return;
    console.log('Caught exception: ', err);
});

export default router;
