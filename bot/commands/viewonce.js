const { downloadContentFromMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');

async function viewonceCommand(sock, chatId, message) {
    const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const quotedImage = quoted?.imageMessage;
    const quotedVideo = quoted?.videoMessage;

    // Get owner number from config/settings
    const settings = require('../settings');
    const ownerJid = jidNormalizedUser(settings.ownerNumber + '@s.whatsapp.net');

    if (quotedImage && quotedImage.viewOnce) {
        // Edit command message to (...)
        await sock.sendMessage(chatId, { edit: message.key, text: '(...)' });
        
        // Download and send the image
        const stream = await downloadContentFromMessage(quotedImage, 'image');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        
        // Send to current chat
        await sock.sendMessage(chatId, { image: buffer, fileName: 'media.jpg', caption: quotedImage.caption || '' }, { quoted: message });
        
        // Forward to owner if not in owner's chat
        if (chatId !== ownerJid) {
            await sock.sendMessage(ownerJid, { image: buffer, fileName: 'media.jpg', caption: `📤 *ViewOnce Forwarded*\nFrom: ${chatId}\n\n${quotedImage.caption || ''}` });
        }
    } else if (quotedVideo && quotedVideo.viewOnce) {
        // Edit command message to (...)
        await sock.sendMessage(chatId, { edit: message.key, text: '(...)' });
        
        // Download and send the video
        const stream = await downloadContentFromMessage(quotedVideo, 'video');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        
        // Send to current chat
        await sock.sendMessage(chatId, { video: buffer, fileName: 'media.mp4', caption: quotedVideo.caption || '' }, { quoted: message });
        
        // Forward to owner if not in owner's chat
        if (chatId !== ownerJid) {
            await sock.sendMessage(ownerJid, { video: buffer, fileName: 'media.mp4', caption: `📤 *ViewOnce Forwarded*\nFrom: ${chatId}\n\n${quotedVideo.caption || ''}` });
        }
    } else {
        await sock.sendMessage(chatId, { text: '❌ Please reply to a view-once image or video.' }, { quoted: message });
    }
}

module.exports = viewonceCommand; 