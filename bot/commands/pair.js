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
                const createResp = await axios.post(`${backendUrl}/api/instances`, {
                    name: `WhatsApp Pair: ${number}`,
                    phone_number: number
                }).catch(e => {
                    console.error('Backend registration error:', e.message);
                    return null;
                });

                if (!createResp || !createResp.data?.id) {
                    throw new Error('Failed to create bot instance in backend');
                }

                const instanceId = createResp.data.id;

                // 2. Approve instance (Sequential Step 2 - This starts the Node process)
                await axios.post(`${backendUrl}/api/instances/${instanceId}/approve`, {
                    duration_months: 1
                });

                // 3. Generate Pairing Code (Sequential Step 3)
                // Wait for the instance to start up
                await sleep(5000);
                
                const response = await axios.get(`https://knight-bot-paircode.onrender.com/code?number=${number}`);
                
                if (response.data && response.data.code) {
                    const code = response.data.code;
                    if (code === "Service Unavailable") {
                        throw new Error('Pairing service unavailable');
                    }
                    
                    await sock.sendMessage(chatId, {
                        text: `*✅ Pairing Code for ${number}:*\n\nCode: *${code}*\n\n_Please enter this code on your WhatsApp to connect._`,
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