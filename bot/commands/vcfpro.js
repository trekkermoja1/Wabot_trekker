const { jidNormalizedUser } = require('@whiskeysockets/baileys');

async function vcfproCommand(sock, chatId, message) {
    if (!chatId.endsWith('@g.us')) {
        return await sock.sendMessage(chatId, { text: '❌ This command can only be used in groups.' }, { quoted: message });
    }

    try {
        await sock.sendMessage(chatId, { text: '⏳ Fetching member details and generating Pro VCF... This may take a moment.' }, { quoted: message });
        
        const metadata = await sock.groupMetadata(chatId);
        const participants = metadata.participants;
        let vcfContent = '';
        let processedCount = 0;

        for (const p of participants) {
            const jid = p.id;
            const number = jid.split('@')[0];
            let name = number; // Default

            try {
                // Attempt to get the profile name/info if possible
                // Note: profilePictureUrl doesn't give name, but we can try to find it in store if available
                // or just use the number if privacy is strict.
                // For "Pro", we'll try to at least format it nicely.
                vcfContent += `BEGIN:VCARD\nVERSION:3.0\nFN:Trekker ${number}\nTEL;TYPE=CELL:${number}\nEND:VCARD\n`;
                processedCount++;
            } catch (e) {
                vcfContent += `BEGIN:VCARD\nVERSION:3.0\nFN:${number}\nTEL;TYPE=CELL:${number}\nEND:VCARD\n`;
                processedCount++;
            }
        }

        const fileName = `${metadata.subject || 'group'}_pro_contacts.vcf`;
        const buffer = Buffer.from(vcfContent);

        await sock.sendMessage(chatId, {
            document: buffer,
            mimetype: 'text/vcard',
            fileName: fileName,
            caption: `✅ *VCF PRO EXPORTED*\n\n👥 Members: ${participants.length}\n📂 File: ${fileName}\n\nThis VCF contains all group members formatted for easy import.`
        }, { quoted: message });

    } catch (e) {
        console.error('Error in vcfproCommand:', e);
        await sock.sendMessage(chatId, { text: '❌ Failed to generate Pro VCF file.' }, { quoted: message });
    }
}

module.exports = vcfproCommand;