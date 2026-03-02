import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';
import axios from 'axios';
import { Pool } from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const SERVER_NAME = process.env.SERVERNAME || process.env.SERVER_NAME || 'server3';
let dbPool;
const DATABASE_URL = process.env.DATABASE_URL;

if (DATABASE_URL) {
    dbPool = new Pool({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
}

function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {
        console.error('Error removing file:', e);
    }
}

async function updateBotInDb(instanceId, phoneNumber, sessionData, status, startStatus, port = null) {
    if (!dbPool) {
        console.log('No database configured, skipping DB update');
        return false;
    }
    
    try {
        const credsJson = JSON.stringify(sessionData);
        
        // Get next available port if not provided
        if (!port) {
            const portResult = await dbPool.query('SELECT MAX(port) as max_port FROM bot_instances WHERE server_name = $1', [SERVER_NAME]);
            port = portResult.rows[0]?.max_port ? portResult.rows[0].max_port + 1 : 4000;
        }
        
        const result = await dbPool.query(
            `INSERT INTO bot_instances (id, phone_number, status, start_status, session_data, server_name, port, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
             ON CONFLICT (id) DO UPDATE SET
                phone_number = $2,
                status = $3,
                start_status = $4,
                session_data = $5,
                server_name = $6,
                port = $7,
                updated_at = NOW()
             RETURNING id`,
            [instanceId, phoneNumber, status, startStatus, credsJson, SERVER_NAME, port]
        );
        
        console.log(`✅ Bot ${instanceId} updated in database: status=${status}, start_status=${startStatus}, port=${port}, server=${SERVER_NAME}`);
        return port;
    } catch (err) {
        console.error('Error updating bot in DB:', err.message);
        return false;
    }
}

async function syncSessionToDb(instanceId, sessionData, port) {
    if (!dbPool) {
        console.log('No database configured, skipping session sync');
        return false;
    }
    
    try {
        const credsJson = JSON.stringify(sessionData);
        
        await dbPool.query(
            `UPDATE bot_instances SET session_data = $1, status = 'connected', port = $3, updated_at = NOW() WHERE id = $2`,
            [credsJson, instanceId, port]
        );
        
        console.log(`✅ Session synced to database for ${instanceId} on port ${port}`);
        return true;
    } catch (err) {
        console.error('Error syncing session to DB:', err.message);
        return false;
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
        // Check if phone number is valid using different possible API methods
        if (phone && typeof phone === 'object') {
            if (typeof phone.isValid === 'function') {
                isValid = phone.isValid();
            } else if (phone.valid === true) {
                isValid = true;
            } else if (phone.number) {
                isValid = true;
            }
            // Try to get formatted number
            if (isValid) {
                try {
                    if (typeof phone.getNumber === 'function') {
                        formattedNum = phone.getNumber('e164').replace('+', '');
                    } else if (phone.number) {
                        formattedNum = phone.number.e164 || phone.number || num;
                        if (formattedNum.startsWith('+')) {
                            formattedNum = formattedNum.replace('+', '');
                        }
                    }
                } catch (fmtError) {
                    console.log('Phone format error:', fmtError.message);
                    formattedNum = num;
                }
            }
        }
    } catch (e) {
        console.error('Phone validation error:', e.message);
        isValid = num.length >= 10; // Fallback
    }
    
    // Additional validation: ensure numeric and minimum length
    if (!isValid || formattedNum.length < 10) {
        isValid = num.replace(/[^0-9]/g, '').length >= 10;
        formattedNum = num.replace(/[^0-9]/g, '');
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
                        // Read session data for DB sync
                        const sessionDataPath = dirs + '/creds.json';
                        const sessionKnight = fs.readFileSync(sessionDataPath);
                        let sessionData;
                        try {
                            sessionData = JSON.parse(sessionKnight.toString());
                        } catch (e) {
                            sessionData = { creds: {} };
                        }

                        // Copy session files to bot's session directory
                        const files = fs.readdirSync(dirs);
                        for (const file of files) {
                            const src = `${dirs}/${file}`;
                            const dest = `${botSessionDir}/${file}`;
                            fs.copyFileSync(src, dest);
                        }
                        console.log("📁 Session files copied to bot directory");

                        // Create/update bot in database with status 'new'
                        const assignedPort = await updateBotInDb(instanceId, num, sessionData, 'new', 'new');
                        console.log("📝 Bot created in database with status 'new'");

                        // Sync session to database
                        await syncSessionToDb(instanceId, sessionData, assignedPort);
                        console.log("💾 Session synced to database");

                        // Update status to connected in database
                        if (dbPool) {
                            await dbPool.query(
                                `UPDATE bot_instances SET status = 'connected', start_status = 'approved', updated_at = NOW() WHERE id = $1`,
                                [instanceId]
                            );
                            console.log("✅ Bot status updated to 'connected' and 'approved' in database");
                        }

                        // Send session file to user
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

Your bot is now connected and registered in the system.

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
                        
                        // Exit after successful pairing and cleanup
                        console.log(`✅ Pairing complete for ${instanceId}. Exiting...`);
                        process.exit(0);
                    } catch (error) {
                        console.error("❌ Error in pairing completion:", error);
                        // Exit anyway after cleanup attempt
                        try {
                            removeFile(dirs);
                        } catch (e) {}
                        process.exit(1);
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
