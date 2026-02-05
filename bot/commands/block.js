const { isSudo } = require('../lib/index');
const isOwnerOrSudo = require('../lib/isOwner');
const { channelInfo } = require('../lib/messageConfig');

async function blockCommand(sock, chatId, message, args) {
    const senderId = message.key.participant || message.key.remoteJid;
    const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
    const senderIsSudo = await isSudo(senderId);

    if (!message.key.fromMe && !isOwner && !senderIsSudo) {
        return await sock.sendMessage(chatId, { text: '❌ Only owner/sudo can use this command.' }, { quoted: message });
    }

    let userToBlock;
    const text = args.join(' ');

    // 1. Check for replied message
    if (message.message?.extendedTextMessage?.contextInfo?.participant) {
        userToBlock = message.message.extendedTextMessage.contextInfo.participant;
    }
    // 2. Check for mentioned users
    else if (message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
        userToBlock = message.message.extendedTextMessage.contextInfo.mentionedJid[0];
    }
    // 3. Check for number in args
    else if (text) {
        const number = text.replace(/[^0-9]/g, '');
        if (number.length >= 7) {
            userToBlock = number + '@s.whatsapp.net';
        }
    }
    // 4. Automatic detection in private chat
    else if (!chatId.endsWith('@g.us')) {
        userToBlock = chatId;
    }

    if (!userToBlock) {
        return await sock.sendMessage(chatId, { 
            text: '❌ Please reply to a message, mention a user, provide a number, or use it in a private chat to block!', 
            ...channelInfo 
        }, { quoted: message });
    }

    try {
        await sock.updateBlockStatus(userToBlock, 'block');
        await sock.sendMessage(chatId, { 
            text: `✅ Successfully blocked @${userToBlock.split('@')[0]}`,
            mentions: [userToBlock],
            ...channelInfo 
        }, { quoted: message });
    } catch (error) {
        console.error('Error in block command:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to block user!', ...channelInfo }, { quoted: message });
    }
}

module.exports = blockCommand;