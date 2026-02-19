const axios = require('axios');
const { sleep } = require('../lib/myfunc');
const settings = require('../settings');

// Helper to try multiple backend URLs
async function axiosRequest(method, path, data = null, options = {}) {
    const fallbacks = [
        process.env.BACKEND_URL,
        settings.backendApiUrl,
        'http://127.0.0.1:5000',
        'http://0.0.0.0:5000',
        'http://localhost:5000'
    ].filter(Boolean);
    
    // Unique list
    const urls = [...new Set(fallbacks)];
    let lastError;

    for (const baseUrl of urls) {
        try {
            const config = {
                method,
                url: `${baseUrl}${path}`,
                data,
                ...options
            };
            return await axios(config);
        } catch (e) {
            lastError = e;
            // Only retry on connection errors
            if (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND') {
                continue;
            }
            throw e;
        }
    }
    throw lastError;
}

const CURRENT_SERVER = process.env.SERVERNAME || 'server1';

async function pairCommand(sock, chatId, message, q) {
    try {
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
                // Step 1: Check if bot already exists in database
                const checkResp = await axiosRequest('GET', `/api/instances/by-phone/${number}`);
                const existingBot = checkResp.data;

                let botId;
                if (existingBot && existingBot.id) {
                    botId = existingBot.id;
                    const botStatus = existingBot.status;

                    if (botStatus === 'connected') {
                        await sock.sendMessage(chatId, {
                            text: `✅ *ALREADY ACTIVE*\n\nThe bot ${number} is already connected. No need to pair.`,
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
                        text: `📋 Bot found. Clearing old sessions and triggering fresh pairing code...`,
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

                    // Trigger regeneration (clears old sessions on bot side)
                    try {
                        await axiosRequest('POST', `/api/instances/${botId}/regenerate-code`);
                    } catch (err) {
                        console.log(`Initial regeneration failed, retrying after a short delay: ${err.message}`);
                        await sleep(5000);
                        await axiosRequest('POST', `/api/instances/${botId}/regenerate-code`);
                    }
                } else {
                    // Bot doesn't exist - create new one
                    await sock.sendMessage(chatId, {
                        text: `📝 Creating new instance for ${number}...`,
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

                    const createResp = await axiosRequest('POST', '/api/instances/pair-new', {
                        name: `WhatsApp Bot: ${number}`,
                        phone_number: number,
                        current_server: CURRENT_SERVER
                    });
                    
                    if (!createResp.data || !createResp.data.id) {
                        throw new Error('Failed to create bot instance');
                    }
                    botId = createResp.data.id;
                }

                // Step 2: Poll for the pairing code (matches frontend logic)
                let pairingCode = null;
                const maxAttempts = 40;
                
                for (let i = 0; i < maxAttempts; i++) {
                    try {
                        const statusResp = await axiosRequest('GET', `/api/instances/${botId}/pairing-code`, null, {
                            timeout: 15000
                        });
                        const code = statusResp.data.pairing_code || statusResp.data.pairingCode;
                        
                        if (code) {
                            pairingCode = code;
                            break;
                        }
                    } catch (e) {
                        console.log(`Polling attempt ${i + 1} failed: ${e.message}`);
                    }
                    await sleep(3000);
                }

                if (pairingCode) {
                    await sock.sendMessage(chatId, {
                        text: `*✅ Pairing Code for ${number}:*\n\nCode: *${pairingCode}*\n\n_Enter this code on WhatsApp > Linked Devices > Link with Phone Number_`,
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
                    
                    // Send the code alone for easy copying
                    await sleep(1000);
                    await sock.sendMessage(chatId, { text: pairingCode });
                } else {
                    throw new Error('Pairing code generation timed out. Please try again.');
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
