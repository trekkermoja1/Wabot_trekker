const axios = require('axios');
const { sleep } = require('../lib/myfunc');
const settings = require('../settings');

const BACKEND_URL = settings.backendApiUrl || 'http://127.0.0.1:8001';
const CURRENT_SERVER = process.env.SERVERNAME || 'server1';

async function pairCommand(sock, chatId, message, q) {
    try {
        if (sock.user && sock.user.id) {
            return await sock.sendMessage(chatId, {
                text: "✅ *ALREADY ACTIVE*\n\nYour bot is already connected and active. There is no need to pair again.",
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363421057570812@newsletter',
                        newsletterName: 'TREKKER-md',
                        serverMessageId: -1
                    }
                }
            }, { quoted: message });
        }
        if (!q) {
            return await sock.sendMessage(chatId, {
                text: "Please provide valid WhatsApp number\nExample: .pair 254702395XXXX",
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363421057570812@newsletter',
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
                        newsletterJid: '120363421057570812@newsletter',
                        newsletterName: 'TREKKER-md',
                        serverMessageId: -1
                    }
                }
            });
        }

        for (const number of numbers) {
            // Check for self-pairing
            const selfNumber = sock.user?.id?.split(':')[0];
            if (number === selfNumber) {
                await sock.sendMessage(chatId, {
                    text: `❌ The number ${number} is already running this bot instance. Self-pairing is not required.`,
                    contextInfo: {
                        forwardingScore: 1,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: '120363421057570812@newsletter',
                            newsletterName: 'TREKKER-md',
                            serverMessageId: -1
                        }
                    }
                });
                continue;
            }

            // Check if number is registered on WhatsApp
            const whatsappID = number + '@s.whatsapp.net';
            const result = await sock.onWhatsApp(whatsappID);

            if (!result[0]?.exists) {
                await sock.sendMessage(chatId, {
                    text: `The number ${number} is not registered on WhatsApp❗️ Skipping...`,
                    contextInfo: {
                        forwardingScore: 1,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: '120363421057570812@newsletter',
                            newsletterName: 'TREKKER-md',
                            serverMessageId: -1
                        }
                    }
                });
                continue;
            }

            await sock.sendMessage(chatId, {
                text: `🔍 Checking database for ${number}...`,
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363421057570812@newsletter',
                        newsletterName: 'TREKKER-md',
                        serverMessageId: -1
                    }
                }
            });

            try {
                // Step 1: Check if bot already exists in database (any status, any server)
                const checkResp = await axios.get(`${BACKEND_URL}/api/instances/by-phone/${number}`);
                const existingBot = checkResp.data;

                if (existingBot && existingBot.id) {
                    // Bot exists in database
                    const botServer = existingBot.server_name;
                    const botStatus = existingBot.status; // connectivity status
                    const botStartStatus = existingBot.start_status; // approval status
                    const botId = existingBot.id;

                    // Don't start pair for bots with start status flagged online (meaning active and connected)
                    if (botStatus === 'connected' && botStartStatus === 'approved') {
                        await sock.sendMessage(chatId, {
                            text: `✅ *ALREADY ACTIVE*\n\nThe bot ${number} is already connected and approved. No need to pair.`,
                            contextInfo: {
                                forwardingScore: 1,
                                isForwarded: true,
                                forwardedNewsletterMessageInfo: {
                                    newsletterJid: '120363421057570812@newsletter',
                                    newsletterName: 'TREKKER-md',
                                    serverMessageId: -1
                                }
                            }
                        });
                        continue;
                    }

                    await sock.sendMessage(chatId, {
                        text: `📋 Found existing bot:\n\nID: \`${botId}\`\nStart Status: ${botStartStatus}\nConn Status: ${botStatus}\nServer: ${botServer}\n\nGenerating pairing code...`,
                        contextInfo: {
                            forwardingScore: 1,
                            isForwarded: true,
                            forwardedNewsletterMessageInfo: {
                                newsletterJid: '120363421057570812@newsletter',
                                newsletterName: 'TREKKER-md',
                                serverMessageId: -1
                            }
                        }
                    });

                    // Generate pairing code via the pair endpoint
                    const pairResp = await axios.post(`${BACKEND_URL}/api/instances/${botId}/pair`, {
                        current_server: CURRENT_SERVER
                    }, { timeout: 90000 });

                    if (pairResp.data && pairResp.data.pairing_code) {
                        const code = pairResp.data.pairing_code;
                        let serverNote = '';
                        if (botServer !== CURRENT_SERVER) {
                            serverNote = `\n\n⚠️ *Note:* This bot belongs to *${botServer}*. Session will be synced to database and status updated.`;
                        }

                        await sock.sendMessage(chatId, {
                            text: `*✅ Pairing Code for ${number}:*\n\nCode: *${code}*\n\n_Enter this code on WhatsApp > Linked Devices > Link with Phone Number_${serverNote}`,
                            contextInfo: {
                                forwardingScore: 1,
                                isForwarded: true,
                                forwardedNewsletterMessageInfo: {
                                    newsletterJid: '120363421057570812@newsletter',
                                    newsletterName: 'TREKKER-md',
                                    serverMessageId: -1
                                }
                            }
                        });
                    } else {
                        throw new Error(pairResp.data?.error || 'Failed to generate pairing code');
                    }
                } else {
                    // Bot doesn't exist - create new one
                    await sock.sendMessage(chatId, {
                        text: `📝 No existing bot found. Creating new instance for ${number}...`,
                        contextInfo: {
                            forwardingScore: 1,
                            isForwarded: true,
                            forwardedNewsletterMessageInfo: {
                                newsletterJid: '120363421057570812@newsletter',
                                newsletterName: 'TREKKER-md',
                                serverMessageId: -1
                            }
                        }
                    });

                    // Create new instance and get pairing code
                    const createResp = await axios.post(`${BACKEND_URL}/api/instances/pair-new`, {
                        name: `WhatsApp Bot: ${number}`,
                        phone_number: number,
                        current_server: CURRENT_SERVER
                    }, { timeout: 90000 });

                    if (createResp.data && createResp.data.pairing_code) {
                        const code = createResp.data.pairing_code;
                        const botId = createResp.data.id;

                        await sock.sendMessage(chatId, {
                            text: `*✅ Pairing Code for ${number}:*\n\nCode: *${code}*\nBot ID: \`${botId}\`\n\n_Enter this code on WhatsApp > Linked Devices > Link with Phone Number_\n\n*Note:* This bot needs approval after pairing. Contact admin.`,
                            contextInfo: {
                                forwardingScore: 1,
                                isForwarded: true,
                                forwardedNewsletterMessageInfo: {
                                    newsletterJid: '120363421057570812@newsletter',
                                    newsletterName: 'TREKKER-md',
                                    serverMessageId: -1
                                }
                            }
                        });
                    } else {
                        throw new Error(createResp.data?.error || 'Failed to create bot instance');
                    }
                }
            } catch (apiError) {
                console.error('Pairing process error:', apiError);
                const errorMessage = apiError.response?.data?.detail || apiError.message || 'Unknown error';
                
                await sock.sendMessage(chatId, {
                    text: `❌ Failed to pair ${number}: ${errorMessage}`,
                    contextInfo: {
                        forwardingScore: 1,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: '120363421057570812@newsletter',
                            newsletterName: 'TREKKER-md',
                            serverMessageId: -1
                        }
                    }
                });
            }

            await sleep(2000);
        }
    } catch (error) {
        console.error('Pair command error:', error);
        await sock.sendMessage(chatId, {
            text: "An error occurred. Please try again later.",
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363421057570812@newsletter',
                    newsletterName: 'TREKKER-md',
                    serverMessageId: -1
                }
            }
        });
    }
}

module.exports = pairCommand;
