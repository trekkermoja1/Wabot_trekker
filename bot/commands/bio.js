async function bioCommand(sock, chatId, message, query) {
    const sender = message.key.participant || message.key.remoteJid;
    const target = query ? (query.replace(/[^0-9]/g, '') + '@s.whatsapp.net') : sender;

    try {
        const profile = await sock.onWhatsApp(target);
        if (!profile || profile.length === 0) {
            return await sock.sendMessage(chatId, { text: '❌ User not found on WhatsApp.' }, { quoted: message });
        }

        let bio = 'No bio found';
        try {
            const status = await sock.fetchStatus(target);
            bio = status.status || bio;
        } catch (e) {}

        const contact = await sock.onWhatsApp(target);
        const name = contact[0]?.notify || 'Unknown';

        const text = `👤 *User Profile*\n\n*Name:* ${name}\n*Number:* ${target.split('@')[0]}\n*Bio:* ${bio}`;
        
        await sock.sendMessage(chatId, { text }, { quoted: message });
    } catch (e) {
        console.error('Error in bioCommand:', e);
        await sock.sendMessage(chatId, { text: '❌ Failed to fetch user bio.' }, { quoted: message });
    }
}

module.exports = bioCommand;