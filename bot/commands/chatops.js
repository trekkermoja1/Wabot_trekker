const { isSudo } = require('../lib/index');
const isOwnerOrSudo = require('../lib/isOwner');
const isAdmin = require('../lib/isAdmin');
const { channelInfo } = require('../lib/messageConfig');

async function checkOwnerPermission(sock, chatId, message, senderId) {
    const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
    const senderIsSudo = await isSudo(senderId);
    if (!message.key.fromMe && !isOwner && !senderIsSudo) {
        await sock.sendMessage(chatId, { text: '❌ Only owner/sudo can use this command.', ...channelInfo }, { quoted: message });
        return false;
    }
    return true;
}

async function archiveChatCommand(sock, chatId, message, args) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await checkOwnerPermission(sock, chatId, message, senderId)) return;

    try {
        await sock.chatModify({ archive: true, lastMessages: [message] }, chatId);
        await sock.sendMessage(chatId, { text: '✅ Chat archived successfully!', ...channelInfo }, { quoted: message });
    } catch (error) {
        console.error('Error archiving chat:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to archive chat!', ...channelInfo }, { quoted: message });
    }
}

async function unarchiveChatCommand(sock, chatId, message, args) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await checkOwnerPermission(sock, chatId, message, senderId)) return;

    try {
        await sock.chatModify({ archive: false, lastMessages: [message] }, chatId);
        await sock.sendMessage(chatId, { text: '✅ Chat unarchived successfully!', ...channelInfo }, { quoted: message });
    } catch (error) {
        console.error('Error unarchiving chat:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to unarchive chat!', ...channelInfo }, { quoted: message });
    }
}

async function muteChatCommand(sock, chatId, message, args) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await checkOwnerPermission(sock, chatId, message, senderId)) return;

    const duration = args[0]?.toLowerCase();
    let muteExpiration;
    
    if (!duration || duration === 'forever' || duration === '-1') {
        muteExpiration = -1;
    } else {
        const hours = parseInt(duration);
        if (isNaN(hours) || hours <= 0) {
            return await sock.sendMessage(chatId, { 
                text: '❌ Usage: .mutechat <hours|forever>\nExample: .mutechat 8 or .mutechat forever', 
                ...channelInfo 
            }, { quoted: message });
        }
        muteExpiration = Date.now() + (hours * 60 * 60 * 1000);
    }

    try {
        await sock.chatModify({ mute: muteExpiration }, chatId);
        const label = muteExpiration === -1 ? 'forever' : `for ${args[0]} hours`;
        await sock.sendMessage(chatId, { text: `✅ Chat muted ${label}!`, ...channelInfo }, { quoted: message });
    } catch (error) {
        console.error('Error muting chat:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to mute chat!', ...channelInfo }, { quoted: message });
    }
}

async function unmuteChatCommand(sock, chatId, message, args) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await checkOwnerPermission(sock, chatId, message, senderId)) return;

    try {
        await sock.chatModify({ mute: null }, chatId);
        await sock.sendMessage(chatId, { text: '✅ Chat unmuted successfully!', ...channelInfo }, { quoted: message });
    } catch (error) {
        console.error('Error unmuting chat:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to unmute chat!', ...channelInfo }, { quoted: message });
    }
}

async function markReadCommand(sock, chatId, message) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await checkOwnerPermission(sock, chatId, message, senderId)) return;

    try {
        await sock.readMessages([message.key]);
        await sock.sendMessage(chatId, { text: '✅ Chat marked as read!', ...channelInfo }, { quoted: message });
    } catch (error) {
        console.error('Error marking chat as read:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to mark chat as read!', ...channelInfo }, { quoted: message });
    }
}

async function markUnreadCommand(sock, chatId, message) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await checkOwnerPermission(sock, chatId, message, senderId)) return;

    try {
        await sock.chatModify({ markRead: false, lastMessages: [message] }, chatId);
        await sock.sendMessage(chatId, { text: '✅ Chat marked as unread!', ...channelInfo }, { quoted: message });
    } catch (error) {
        console.error('Error marking chat as unread:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to mark chat as unread!', ...channelInfo }, { quoted: message });
    }
}

async function starMessageCommand(sock, chatId, message) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await checkOwnerPermission(sock, chatId, message, senderId)) return;

    const quotedMsg = message.message?.extendedTextMessage?.contextInfo;
    if (!quotedMsg?.stanzaId) {
        return await sock.sendMessage(chatId, { text: '❌ Please reply to a message to star it!', ...channelInfo }, { quoted: message });
    }

    try {
        await sock.chatModify({
            star: {
                messages: [{ id: quotedMsg.stanzaId, fromMe: quotedMsg.participant ? false : true }],
                star: true
            }
        }, chatId);
        await sock.sendMessage(chatId, { text: '⭐ Message starred!', ...channelInfo }, { quoted: message });
    } catch (error) {
        console.error('Error starring message:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to star message!', ...channelInfo }, { quoted: message });
    }
}

async function unstarMessageCommand(sock, chatId, message) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await checkOwnerPermission(sock, chatId, message, senderId)) return;

    const quotedMsg = message.message?.extendedTextMessage?.contextInfo;
    if (!quotedMsg?.stanzaId) {
        return await sock.sendMessage(chatId, { text: '❌ Please reply to a message to unstar it!', ...channelInfo }, { quoted: message });
    }

    try {
        await sock.chatModify({
            star: {
                messages: [{ id: quotedMsg.stanzaId, fromMe: quotedMsg.participant ? false : true }],
                star: false
            }
        }, chatId);
        await sock.sendMessage(chatId, { text: '⭐ Message unstarred!', ...channelInfo }, { quoted: message });
    } catch (error) {
        console.error('Error unstarring message:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to unstar message!', ...channelInfo }, { quoted: message });
    }
}

async function disappearingCommand(sock, chatId, message, args) {
    const senderId = message.key.participant || message.key.remoteJid;
    const isGroup = chatId.endsWith('@g.us');
    
    if (isGroup) {
        const { isSenderAdmin, isBotAdmin } = await isAdmin(sock, chatId, senderId);
        if (!isBotAdmin) {
            return await sock.sendMessage(chatId, { text: '❌ Bot needs to be admin to change disappearing messages!', ...channelInfo }, { quoted: message });
        }
        if (!isSenderAdmin) {
            const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
            if (!isOwner) {
                return await sock.sendMessage(chatId, { text: '❌ Only admins can change disappearing messages!', ...channelInfo }, { quoted: message });
            }
        }
    } else {
        if (!await checkOwnerPermission(sock, chatId, message, senderId)) return;
    }

    const duration = args[0]?.toLowerCase();
    let expiration;
    
    const durationMap = {
        'off': 0,
        '0': 0,
        '24h': 86400,
        '1d': 86400,
        '7d': 604800,
        '1w': 604800,
        '90d': 7776000,
        '3m': 7776000
    };

    if (!duration || !durationMap.hasOwnProperty(duration)) {
        return await sock.sendMessage(chatId, { 
            text: '❌ Usage: .disappearing <off|24h|7d|90d>\n\noff = Disable\n24h/1d = 24 hours\n7d/1w = 7 days\n90d/3m = 90 days', 
            ...channelInfo 
        }, { quoted: message });
    }

    expiration = durationMap[duration];

    try {
        await sock.sendMessage(chatId, { disappearingMessagesInChat: expiration });
        const labels = { 0: 'disabled', 86400: '24 hours', 604800: '7 days', 7776000: '90 days' };
        await sock.sendMessage(chatId, { text: `✅ Disappearing messages: ${labels[expiration]}`, ...channelInfo }, { quoted: message });
    } catch (error) {
        console.error('Error setting disappearing messages:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to set disappearing messages!', ...channelInfo }, { quoted: message });
    }
}

async function pinMessageCommand(sock, chatId, message, args) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await checkOwnerPermission(sock, chatId, message, senderId)) return;

    const quotedMsg = message.message?.extendedTextMessage?.contextInfo;
    if (!quotedMsg?.stanzaId) {
        return await sock.sendMessage(chatId, { text: '❌ Please reply to a message to pin it!', ...channelInfo }, { quoted: message });
    }

    const duration = parseInt(args[0]) || 86400;

    try {
        await sock.sendMessage(chatId, { 
            pin: { 
                type: 1,
                time: duration
            }
        }, { quoted: { key: { remoteJid: chatId, id: quotedMsg.stanzaId } } });
        await sock.sendMessage(chatId, { text: `📌 Message pinned for ${Math.round(duration / 3600)} hours!`, ...channelInfo }, { quoted: message });
    } catch (error) {
        console.error('Error pinning message:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to pin message!', ...channelInfo }, { quoted: message });
    }
}

async function unpinMessageCommand(sock, chatId, message) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await checkOwnerPermission(sock, chatId, message, senderId)) return;

    const quotedMsg = message.message?.extendedTextMessage?.contextInfo;
    if (!quotedMsg?.stanzaId) {
        return await sock.sendMessage(chatId, { text: '❌ Please reply to a pinned message to unpin it!', ...channelInfo }, { quoted: message });
    }

    try {
        await sock.sendMessage(chatId, { 
            pin: { 
                type: 2,
                time: 0
            }
        }, { quoted: { key: { remoteJid: chatId, id: quotedMsg.stanzaId } } });
        await sock.sendMessage(chatId, { text: '📌 Message unpinned!', ...channelInfo }, { quoted: message });
    } catch (error) {
        console.error('Error unpinning message:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to unpin message!', ...channelInfo }, { quoted: message });
    }
}

async function deleteChatCommand(sock, chatId, message) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await checkOwnerPermission(sock, chatId, message, senderId)) return;

    try {
        await sock.chatModify({ delete: true, lastMessages: [{ key: message.key, messageTimestamp: message.messageTimestamp }] }, chatId);
        await sock.sendMessage(chatId, { text: '✅ Chat deleted!', ...channelInfo }, { quoted: message });
    } catch (error) {
        console.error('Error deleting chat:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to delete chat!', ...channelInfo }, { quoted: message });
    }
}

async function clearChatCommand(sock, chatId, message) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await checkOwnerPermission(sock, chatId, message, senderId)) return;

    try {
        await sock.chatModify({ clear: { messages: [{ id: message.key.id, fromMe: message.key.fromMe, timestamp: message.messageTimestamp }] } }, chatId);
        await sock.sendMessage(chatId, { text: '✅ Chat cleared!', ...channelInfo }, { quoted: message });
    } catch (error) {
        console.error('Error clearing chat:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to clear chat!', ...channelInfo }, { quoted: message });
    }
}

async function rejectCallCommand(sock, chatId, message, callId, callFrom) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await checkOwnerPermission(sock, chatId, message, senderId)) return;

    try {
        await sock.rejectCall(callId, callFrom);
        await sock.sendMessage(chatId, { text: '✅ Call rejected!', ...channelInfo }, { quoted: message });
    } catch (error) {
        console.error('Error rejecting call:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to reject call!', ...channelInfo }, { quoted: message });
    }
}

module.exports = {
    archiveChatCommand,
    unarchiveChatCommand,
    muteChatCommand,
    unmuteChatCommand,
    markReadCommand,
    markUnreadCommand,
    starMessageCommand,
    unstarMessageCommand,
    disappearingCommand,
    pinMessageCommand,
    unpinMessageCommand,
    deleteChatCommand,
    clearChatCommand,
    rejectCallCommand
};
