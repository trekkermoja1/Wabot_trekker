const { jidNormalizedUser } = require('@whiskeysockets/baileys');

async function vcfCommand(sock, chatId, message) {
    if (!chatId.endsWith('@g.us')) {
        return await sock.sendMessage(chatId, { text: '❌ This command can only be used in groups.' }, { quoted: message });
    }

    try {
        const metadata = await sock.groupMetadata(chatId);
        const participants = metadata.participants;
        let vcfContent = '';

        for (const p of participants) {
            const jid = p.id;
            const number = jid.split('@')[0];
            const name = number; // Default name to number
            vcfContent += `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL;TYPE=CELL:${number}\nEND:VCARD\n`;
        }

        const fileName = `${metadata.subject || 'group'}_contacts.vcf`;
        const buffer = Buffer.from(vcfContent);

        await sock.sendMessage(chatId, {
            document: buffer,
            mimetype: 'text/vcard',
            fileName: fileName,
            caption: `✅ Exported ${participants.length} contacts from *${metadata.subject}*`
        }, { quoted: message });

    } catch (e) {
        console.error('Error in vcfCommand:', e);
        await sock.sendMessage(chatId, { text: '❌ Failed to generate VCF file.' }, { quoted: message });
    }
}

module.exports = vcfCommand;