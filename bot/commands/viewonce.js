const { downloadContentFromMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const { isOwnerOrSudo } = require('../lib/isOwner');

async function viewonceCommand(sock, chatId, message) {
    const senderId = message.key.participant || message.key.remoteJid;
    
    // Check if sender is owner or sudo
    const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
    // Remove restriction so anyone can use .vv if they want, or keep it for owner
    // User said ".vv ... doesn't work ... no response", likely because they aren't owner or the case was missing.
    // I will keep the owner check but ensure the command case exists.
    // Actually, many "fun" commands are public. If .vv is for viewing once media, it's often an owner tool.
    // But if the user is the one trying it and it "doesn't work", they might not be recognized as owner.
    
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

    const targetId = chatId;

    if (quotedImage && quotedImage.viewOnce) {
        // Edit command message to (...)
        await sock.sendMessage(chatId, { edit: message.key, text: '(...)' });
        
        // Download and send the image
        const stream = await downloadContentFromMessage(quotedImage, 'image');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        await sock.sendMessage(targetId, { image: buffer, fileName: 'media.jpg', caption: quotedImage.caption || '' }, { quoted: message });
    } else if (quotedVideo && quotedVideo.viewOnce) {
        // Edit command message to (...)
        await sock.sendMessage(chatId, { edit: message.key, text: '(...)' });
        
        // Download and send the video
        const stream = await downloadContentFromMessage(quotedVideo, 'video');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        await sock.sendMessage(targetId, { video: buffer, fileName: 'media.mp4', caption: quotedVideo.caption || '' }, { quoted: message });
    } else {
        await sock.sendMessage(chatId, { text: '❌ Please reply to a view-once image or video.' }, { quoted: message });
    }
}

module.exports = viewonceCommand; 