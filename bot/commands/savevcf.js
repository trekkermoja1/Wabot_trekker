const { getAllVCardContacts } = require('../lib/chatDb');

async function savecfCommand(sock, chatId, message) {
    try {
        const botJid = sock?.user?.id;
        if (!botJid) {
            await sock.sendMessage(chatId, { text: '❌ Bot not ready' }, { quoted: message });
            return;
        }

        const contacts = await getAllVCardContacts(botJid);
        
        if (contacts.length === 0) {
            await sock.sendMessage(chatId, { text: '📇 No contacts saved yet!' }, { quoted: message });
            return;
        }

        const botName = sock?.user?.name || sock?.user?.pushName || 'Bot';
        
        let vcfContent = '';
        for (let i = 0; i < contacts.length; i++) {
            const contact = contacts[i];
            const name = contact.contact_name || botName;
            const phone = contact.contact_phone;
            
            vcfContent += `BEGIN:VCARD
VERSION:3.0
FN:${name}
TEL;TYPE=CELL:${phone}
END:VCARD
`;
        }

        const buffer = Buffer.from(vcfContent, 'utf-8');
        
        await sock.sendMessage(chatId, {
            document: buffer,
            fileName: `contacts_${botName.replace(/\s+/g, '_')}.vcf`,
            mimetype: 'text/vcard'
        }, { quoted: message });

    } catch (error) {
        console.error('Error in .savevcf command:', error);
        await sock.sendMessage(chatId, { text: '❌ Error exporting contacts' }, { quoted: message });
    }
}

module.exports = { savecfCommand };
