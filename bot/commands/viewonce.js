const { downloadContentFromMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');

async function viewonceCommand(sock, chatId, message) {
    // Extract quoted imageMessage or videoMessage from your structure
    const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const quotedImage = quoted?.imageMessage;
    const quotedVideo = quoted?.videoMessage;

    // Get owner number from config
    let ownerNumber = '';
    try {
        const configPath = path.join(__dirname, '..', '..', 'data', 'config.json');
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            ownerNumber = config.ownerNumber || '';
        }
    } catch (e) {
        console.error('Error reading owner number:', e);
    }

    const targetId = ownerNumber ? jidNormalizedUser(ownerNumber + '@s.whatsapp.net') : chatId;

    if (quotedImage && quotedImage.viewOnce) {
        // Download and send the image
        const stream = await downloadContentFromMessage(quotedImage, 'image');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        await sock.sendMessage(targetId, { image: buffer, fileName: 'media.jpg', caption: quotedImage.caption || '' });
        if (targetId !== chatId) {
            await sock.sendMessage(chatId, { text: '✅ View-once media sent to owner.' }, { quoted: message });
        }
    } else if (quotedVideo && quotedVideo.viewOnce) {
        // Download and send the video
        const stream = await downloadContentFromMessage(quotedVideo, 'video');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        await sock.sendMessage(targetId, { video: buffer, fileName: 'media.mp4', caption: quotedVideo.caption || '' });
        if (targetId !== chatId) {
            await sock.sendMessage(chatId, { text: '✅ View-once media sent to owner.' }, { quoted: message });
        }
    } else {
        await sock.sendMessage(chatId, { text: '❌ Please reply to a view-once image or video.' }, { quoted: message });
    }
}

module.exports = viewonceCommand; 