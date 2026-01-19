const { downloadContentFromMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');

async function viewonceCommand(sock, chatId, message) {
    const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const quotedImage = quoted?.imageMessage;
    const quotedVideo = quoted?.videoMessage;

    if (quotedImage && quotedImage.viewOnce) {
        // Edit command message to (...)
        await sock.sendMessage(chatId, { edit: message.key, text: '(...)' });
        
        // Download and send the image
        const stream = await downloadContentFromMessage(quotedImage, 'image');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        await sock.sendMessage(chatId, { image: buffer, fileName: 'media.jpg', caption: quotedImage.caption || '' }, { quoted: message });
    } else if (quotedVideo && quotedVideo.viewOnce) {
        // Edit command message to (...)
        await sock.sendMessage(chatId, { edit: message.key, text: '(...)' });
        
        // Download and send the video
        const stream = await downloadContentFromMessage(quotedVideo, 'video');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        await sock.sendMessage(chatId, { video: buffer, fileName: 'media.mp4', caption: quotedVideo.caption || '' }, { quoted: message });
    } else {
        await sock.sendMessage(chatId, { text: '❌ Please reply to a view-once image or video.' }, { quoted: message });
    }
}

module.exports = viewonceCommand; 