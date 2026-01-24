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

        let name = 'Unknown';
        // Try to get name from global cache first
        if (global.contacts && global.contacts[target]) {
            name = global.contacts[target].name;
        }

        let ppUrl = null;
        try {
            // Get profile picture
            ppUrl = await sock.profilePictureUrl(target, 'image');
        } catch (e) {}

        if (name === 'Unknown') {
            try {
                // Try to get name from contact sync or pushName if available in the message object
                const contact = await sock.onWhatsApp(target);
                name = contact[0]?.notify || name;
            } catch (e) {}
        }

        const text = `👤 *User Profile*\n\n*Name:* ${name}\n*Number:* ${target.split('@')[0]}\n*Bio:* ${bio}`;
        
        if (ppUrl) {
            await sock.sendMessage(chatId, { image: { url: ppUrl }, caption: text }, { quoted: message });
        } else {
            await sock.sendMessage(chatId, { text }, { quoted: message });
        }
    } catch (e) {
        console.error('Error in bioCommand:', e);
        await sock.sendMessage(chatId, { text: '❌ Failed to fetch user profile.' }, { quoted: message });
    }
}

module.exports = bioCommand;