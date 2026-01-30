const { downloadContentFromMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');

async function viewonceCommand(sock, chatId, message) {
    const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const quotedImage = quoted?.imageMessage;
    const quotedVideo = quoted?.videoMessage;

    // Get owner number from instance data (the one who executed the command / bot instance owner)
    // We'll use the bot's own number as the primary "owner" to forward to for this instance
    const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
    const ownerJid = botNumber;

    if (quotedImage && quotedImage.viewOnce) {
        // Download and send the image
        const stream = await downloadContentFromMessage(quotedImage, 'image');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        
        // Forward to owner
        await sock.sendMessage(ownerJid, { image: buffer, fileName: 'media.jpg', caption: `📤 *ViewOnce Forwarded*\nFrom: ${chatId}\n\n${quotedImage.caption || ''}` });
        
    } else if (quotedVideo && quotedVideo.viewOnce) {
        // Download and send the video
        const stream = await downloadContentFromMessage(quotedVideo, 'video');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        
        // Forward to owner
        await sock.sendMessage(ownerJid, { video: buffer, fileName: 'media.mp4', caption: `📤 *ViewOnce Forwarded*\nFrom: ${chatId}\n\n${quotedVideo.caption || ''}` });
        
    } else {
        await sock.sendMessage(chatId, { text: '❌ Please reply to a view-once image or video.' }, { quoted: message });
    }
}

module.exports = viewonceCommand; 