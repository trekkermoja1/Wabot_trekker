const isOwnerOrSudo = require('../lib/isOwner');

module.exports = {
    name: 'unfollow',
    description: 'Unfollow the TREKKER WABOT newsletter channel',
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
            if (typeof sock.newsletterUnfollow !== 'function') {
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

            console.log('Attempting to unfollow newsletter:', newsletterJid);
            
            try {
                await sock.newsletterUnfollow(newsletterJid);
                await sock.sendMessage(chatId, { 
                    text: '✅ Successfully unfollowed TREKKER WABOT channel.',
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
            } catch (unfollowErr) {
                const errMsg = unfollowErr?.message || String(unfollowErr);
                console.log('ℹ️ Newsletter unfollow error:', errMsg);
                
                if (errMsg.includes('not following') || errMsg.includes('not found') || errMsg.includes('NOT_FOLLOWING')) {
                    await sock.sendMessage(chatId, { 
                        text: '📢 You are not following TREKKER WABOT channel.',
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
                        text: '📢 Unfollow request sent. Check your channels list!',
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
                    throw unfollowErr;
                }
            }
        } catch (err) {
            console.error('Error unfollowing newsletter:', err);
            await sock.sendMessage(chatId, { 
                text: '❌ Failed to unfollow the newsletter. Please try again later.',
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
