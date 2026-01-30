module.exports = {
    name: 'unfollow',
    description: 'Unfollow the specified newsletter channel',
    async execute(sock, chatId, m, args) {
        const newsletterJid = '120363161513685998@newsletter';
        try {
            await sock.newsletterUnfollow(newsletterJid);
            await sock.sendMessage(chatId, { text: '✅ Successfully unfollowed the newsletter channel.' }, { quoted: m });
        } catch (err) {
            console.error('Error unfollowing newsletter:', err);
            await sock.sendMessage(chatId, { text: '❌ Failed to unfollow the newsletter.' }, { quoted: m });
        }
    }
};
