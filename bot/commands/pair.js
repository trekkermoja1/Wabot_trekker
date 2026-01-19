const axios = require('axios');
const { sleep } = require('../lib/myfunc');

async function pairCommand(sock, chatId, message, q) {
    try {
        if (!q) {
            return await sock.sendMessage(chatId, {
                text: "Please provide valid WhatsApp number\nExample: .pair 91702395XXXX",
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363161513685998@newsletter',
                        newsletterName: 'TREKKER-md',
                        serverMessageId: -1
                    }
                }
            });
        }

        const numbers = q.split(',')
            .map((v) => v.replace(/[^0-9]/g, ''))
            .filter((v) => v.length > 5 && v.length < 20);

        if (numbers.length === 0) {
            return await sock.sendMessage(chatId, {
                text: "Invalid number❌️ Please use the correct format!",
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363161513685998@newsletter',
                        newsletterName: 'TREKKER-md',
                        serverMessageId: -1
                    }
                }
            });
        }

        for (const number of numbers) {
            // Check for self-pairing
            const selfNumber = sock.user.id.split(':')[0];
            if (number === selfNumber) {
                await sock.sendMessage(chatId, {
                    text: `❌ The number ${number} is already running this bot instance. Self-pairing is not required.`,
                    contextInfo: {
                        forwardingScore: 1,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: '120363161513685998@newsletter',
                            newsletterName: 'TREKKER-md',
                            serverMessageId: -1
                        }
                    }
                });
                continue;
            }

            const whatsappID = number + '@s.whatsapp.net';
            const result = await sock.onWhatsApp(whatsappID);

            if (!result[0]?.exists) {
                await sock.sendMessage(chatId, {
                    text: `The number ${number} is not registered on WhatsApp❗️ Skipping...`,
                    contextInfo: {
                        forwardingScore: 1,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: '120363161513685998@newsletter',
                            newsletterName: 'TREKKER-md',
                            serverMessageId: -1
                        }
                    }
                });
                continue; // Move to next number sequentially
            }

            await sock.sendMessage(chatId, {
                text: `Processing pairing for ${number}. Please wait for the code...`,
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363161513685998@newsletter',
                        newsletterName: 'TREKKER-md',
                        serverMessageId: -1
                    }
                }
            });

            try {
                // Call local backend to handle instance creation/update
                const backendUrl = process.env.BACKEND_URL || 'http://localhost:5000';
                
                // 1. Create instance (Sequential Step 1)
                // The backend now returns the target_server based on capacity
                const createResp = await axios.post(`${backendUrl}/api/instances`, {
                    name: `WhatsApp Pair: ${number}`,
                    phone_number: number,
                    auto_start: false // NEW: Tell backend not to start the process automatically
                }).catch(e => {
                    console.error('Backend registration error:', e.message);
                    return null;
                });

                if (!createResp || !createResp.data?.id) {
                    throw new Error(createResp?.data?.detail || 'Failed to create bot instance in backend');
                }

                const instanceId = createResp.data.id;
                const targetServer = createResp.data.server_name;
                const currentServer = process.env.SERVERNAME || 'server1';

                // Drop current session files if it already exists locally to ensure clean pairing
                const fs = require('fs');
                const path = require('path');
                const sessionDir = path.join(__dirname, '..', 'instances', instanceId, 'session');
                if (fs.existsSync(sessionDir)) {
                    try {
                        fs.rmSync(sessionDir, { recursive: true, force: true });
                        console.log(`Cleared existing session for ${instanceId} to allow re-pairing.`);
                    } catch (e) {
                        console.error('Error clearing session:', e);
                    }
                }

                // 2. Generate Pairing Code (Sequential Step 2)
                // Use the local instance for pairing instead of external service to ensure it matches the instance created
                const portResp = createResp.data.port;
                let code = null;
                
                // Wait for the local instance to be ready and provide a code
                let attempts = 0;
                while (!code && attempts < 20) {
                    try {
                        const statusResp = await axios.get(`http://localhost:${portResp}/pairing-code`);
                        if (statusResp.data && statusResp.data.pairingCode) {
                            code = statusResp.data.pairingCode;
                            break;
                        }
                    } catch (e) {
                        console.log(`Polling local port ${portResp} attempt ${attempts}: ${e.message}`);
                    }
                    await sleep(2000); // Increased sleep to 2s
                    attempts++;
                }

                if (code) {
                    let handoffMessage = "";
                    if (targetServer !== currentServer) {
                        handoffMessage = `\n\n*Note:* This bot is assigned to *${targetServer}* tenancy.`;
                    }

                    await sock.sendMessage(chatId, {
                        text: `*✅ Pairing Code for ${number}:*\n\nCode: *${code}*\n\n_Please enter this code on your WhatsApp to connect._\n${handoffMessage}\n\n*Important:* This is a separate instance. Your current bot remains active.`,
                        contextInfo: {
                            forwardingScore: 1,
                            isForwarded: true,
                            forwardedNewsletterMessageInfo: {
                                newsletterJid: '120363161513685998@newsletter',
                                newsletterName: 'TREKKER-md',
                                serverMessageId: -1
                            }
                        }
                    });
                } else {
                    throw new Error('Invalid response from pairing service');
                }
            } catch (apiError) {
                console.error('Pairing process error:', apiError);
                const errorMessage = `❌ Failed to pair ${number}: ${apiError.message}`;
                
                await sock.sendMessage(chatId, {
                    text: errorMessage,
                    contextInfo: {
                        forwardingScore: 1,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: '120363161513685998@newsletter',
                            newsletterName: 'TREKKER-md',
                            serverMessageId: -1
                        }
                    }
                });
            }
            // Small delay between sequential registrations to avoid race conditions
            await sleep(2000);
        }
    } catch (error) {
        console.error(error);
        await sock.sendMessage(chatId, {
            text: "An error occurred. Please try again later.",
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363161513685998@newsletter',
                    newsletterName: 'KnightBot MD',
                    serverMessageId: -1
                }
            }
        });
    }
}

module.exports = pairCommand; 