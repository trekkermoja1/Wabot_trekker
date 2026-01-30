module.exports = {
    name: 'follow',
    description: 'Follow the specified newsletter channel',
    async execute(sock, chatId, m, args) {
        const newsletterJid = '120363421057570812@newsletter';
        try {
            await sock.newsletterFollow(newsletterJid);
            await sock.sendMessage(chatId, { text: '✅ Successfully followed the newsletter channel.' }, { quoted: m });
        } catch (err) {
            console.error('Error following newsletter:', err);
            await sock.sendMessage(chatId, { text: '❌ Failed to follow the newsletter.' }, { quoted: m });
        }
    }
};
