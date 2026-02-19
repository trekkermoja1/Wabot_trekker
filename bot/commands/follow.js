const isOwnerOrSudo = require('../lib/isOwner');

module.exports = {
    name: 'follow',
    description: 'Follow the TREKKER WABOT newsletter channel',
    async execute(sock, chatId, m, args) {
        const newsletterJid = '120363421057570812@newsletter';
        
        try {
            const senderId = m.key.participant || m.key.remoteJid;
            const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
            
            if (!m.key.fromMe && !isOwner) {
                await sock.sendMessage(chatId, {
                    text: '❌ This command is only available for the owner!',
                    contextInfo: {
                        forwardingScore: 1,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: newsletterJid,
                            newsletterName: 'TREKKER WABOT MD',
                            serverMessageId: -1
                        }
                    }
                });
                return;
            }

            // Check if newsletter API is available
            if (typeof sock.newsletterFollow !== 'function') {
                await sock.sendMessage(chatId, { 
                    text: '❌ Newsletter API not available in this version.',
                    contextInfo: {
                        forwardingScore: 1,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: newsletterJid,
                            newsletterName: 'TREKKER WABOT MD',
                            serverMessageId: -1
                        }
                    }
                }, { quoted: m });
                return;
            }

            // Try to get newsletter metadata first
            let channelName = 'TREKKER WABOT';
            console.log('Attempting to follow newsletter:', newsletterJid);
            try {
                const metadata = await sock.newsletterMetadata("jid", newsletterJid);
                channelName = metadata?.name || channelName;
                console.log('Newsletter metadata:', channelName);
            } catch (metaErr) {
                console.log('Could not fetch newsletter metadata:', metaErr.message);
            }

            try {
                await sock.newsletterFollow(newsletterJid);
                await sock.sendMessage(chatId, { 
                    text: `✅ Successfully followed ${channelName} channel!`,
                    contextInfo: {
                        forwardingScore: 1,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: newsletterJid,
                            newsletterName: 'TREKKER WABOT MD',
                            serverMessageId: -1
                        }
                    }
                }, { quoted: m });
            } catch (followErr) {
                const errMsg = followErr?.message || String(followErr);
                console.log('ℹ️ Newsletter follow returned structural error, checking if already followed...');
                
                if (errMsg.includes('already') || errMsg.includes('subscribed') || errMsg.includes('ALREADY_FOLLOWING')) {
                    await sock.sendMessage(chatId, { 
                        text: `📢 You are already following ${channelName} channel!`,
                        contextInfo: {
                            forwardingScore: 1,
                            isForwarded: true,
                            forwardedNewsletterMessageInfo: {
                                newsletterJid: newsletterJid,
                                newsletterName: 'TREKKER WABOT MD',
                                serverMessageId: -1
                            }
                        }
                    }, { quoted: m });
                } else if (errMsg.includes('unexpected response')) {
                    // Known Baileys API issue - the action may still work
                    await sock.sendMessage(chatId, { 
                        text: `📢 Follow request sent to ${channelName} channel. Check your channels list!`,
                        contextInfo: {
                            forwardingScore: 1,
                            isForwarded: true,
                            forwardedNewsletterMessageInfo: {
                                newsletterJid: newsletterJid,
                                newsletterName: 'TREKKER WABOT MD',
                                serverMessageId: -1
                            }
                        }
                    }, { quoted: m });
                } else {
                    throw followErr;
                }
            }
        } catch (err) {
            console.error('Error following newsletter:', err);
            await sock.sendMessage(chatId, { 
                text: '❌ Failed to follow the newsletter. Please try again later.',
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: newsletterJid,
                        newsletterName: 'TREKKER WABOT MD',
                        serverMessageId: -1
                    }
                }
            }, { quoted: m });
        }
    }
};
