const { isSudo } = require('../lib/index');
const isOwnerOrSudo = require('../lib/isOwner');
const { channelInfo } = require('../lib/messageConfig');

async function unblockCommand(sock, chatId, message, args) {
    const senderId = message.key.participant || message.key.remoteJid;
    const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
    const senderIsSudo = await isSudo(senderId);

    if (!message.key.fromMe && !isOwner && !senderIsSudo) {
        return await sock.sendMessage(chatId, { text: '❌ Only owner/sudo can use this command.' }, { quoted: message });
    }

    let userToUnblock;
    const text = args.join(' ');

    // 1. Check for replied message
    if (message.message?.extendedTextMessage?.contextInfo?.participant) {
        userToUnblock = message.message.extendedTextMessage.contextInfo.participant;
    }
    // 2. Check for mentioned users
    else if (message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
        userToUnblock = message.message.extendedTextMessage.contextInfo.mentionedJid[0];
    }
    // 3. Check for number in args
    else if (text) {
        const number = text.replace(/[^0-9]/g, '');
        if (number.length >= 7) {
            userToUnblock = number + '@s.whatsapp.net';
        }
    }
    // 4. Automatic detection in private chat
    else if (!chatId.endsWith('@g.us')) {
        userToUnblock = chatId;
    }

    if (!userToUnblock) {
        return await sock.sendMessage(chatId, { 
            text: '❌ Please reply to a message, mention a user, provide a number, or use it in a private chat to unblock!', 
            ...channelInfo 
        }, { quoted: message });
    }

    try {
        await sock.updateBlockStatus(userToUnblock, 'unblock');
        await sock.sendMessage(chatId, { 
            text: `✅ Successfully unblocked @${userToUnblock.split('@')[0]}`,
            mentions: [userToUnblock],
            ...channelInfo 
        }, { quoted: message });
    } catch (error) {
        console.error('Error in unblock command:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to unblock user!', ...channelInfo }, { quoted: message });
    }
}

module.exports = unblockCommand;