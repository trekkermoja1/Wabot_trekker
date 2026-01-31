const { isSudo } = require('../lib/index');
const isOwnerOrSudo = require('../lib/isOwner');
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

async function blockCommand(sock, chatId, message, args) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await checkOwnerPermission(sock, chatId, message, senderId)) return;

    let userToBlock;
    const text = args.join(' ');

    if (message.message?.extendedTextMessage?.contextInfo?.participant) {
        userToBlock = message.message.extendedTextMessage.contextInfo.participant;
    } else if (message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
        userToBlock = message.message.extendedTextMessage.contextInfo.mentionedJid[0];
    } else if (text) {
        const number = text.replace(/[^0-9]/g, '');
        if (number.length >= 7) {
            userToBlock = number + '@s.whatsapp.net';
        }
    } else if (!chatId.endsWith('@g.us')) {
        userToBlock = chatId;
    }

    if (!userToBlock) {
        return await sock.sendMessage(chatId, { 
            text: '❌ Please reply to a message, mention a user, or provide a number to block!', 
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
        await sock.sendMessage(chatId, { text: '❌ Failed to block user! ' + error.message, ...channelInfo }, { quoted: message });
    }
}

async function unblockCommand(sock, chatId, message, args) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await checkOwnerPermission(sock, chatId, message, senderId)) return;

    let userToUnblock;
    const text = args.join(' ');

    if (message.message?.extendedTextMessage?.contextInfo?.participant) {
        userToUnblock = message.message.extendedTextMessage.contextInfo.participant;
    } else if (message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
        userToUnblock = message.message.extendedTextMessage.contextInfo.mentionedJid[0];
    } else if (text) {
        const number = text.replace(/[^0-9]/g, '');
        if (number.length >= 7) {
            userToUnblock = number + '@s.whatsapp.net';
        }
    } else if (!chatId.endsWith('@g.us')) {
        userToUnblock = chatId;
    }

    if (!userToUnblock) {
        return await sock.sendMessage(chatId, { 
            text: '❌ Please reply to a message, mention a user, or provide a number to unblock!', 
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
        await sock.sendMessage(chatId, { text: '❌ Failed to unblock user! ' + error.message, ...channelInfo }, { quoted: message });
    }
}

async function blocklistCommand(sock, chatId, message) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await checkOwnerPermission(sock, chatId, message, senderId)) return;

    try {
        const blocklist = await sock.fetchBlocklist();
        if (!blocklist || blocklist.length === 0) {
            return await sock.sendMessage(chatId, { text: '📋 Your blocklist is empty.', ...channelInfo }, { quoted: message });
        }
        
        let text = `📋 *BLOCKED USERS* (${blocklist.length})\n\n`;
        blocklist.forEach((jid, index) => {
            text += `${index + 1}. @${jid.split('@')[0]}\n`;
        });
        
        await sock.sendMessage(chatId, { text, mentions: blocklist, ...channelInfo }, { quoted: message });
    } catch (error) {
        console.error('Error fetching blocklist:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to fetch blocklist!', ...channelInfo }, { quoted: message });
    }
}

async function getPrivacySettingsCommand(sock, chatId, message) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await checkOwnerPermission(sock, chatId, message, senderId)) return;

    try {
        const privacy = await sock.fetchPrivacySettings(true);
        let text = `🔒 *PRIVACY SETTINGS*\n\n`;
        text += `👁️ Last Seen: ${privacy.readreceipts || 'unknown'}\n`;
        text += `🟢 Online: ${privacy.online || 'unknown'}\n`;
        text += `🖼️ Profile Photo: ${privacy.profile || 'unknown'}\n`;
        text += `📝 Status: ${privacy.status || 'unknown'}\n`;
        text += `✅ Read Receipts: ${privacy.readreceipts || 'unknown'}\n`;
        text += `👥 Groups Add: ${privacy.groupadd || 'unknown'}\n`;
        text += `⏳ Default Disappearing: ${privacy.disappearing || 'off'}\n`;
        
        await sock.sendMessage(chatId, { text, ...channelInfo }, { quoted: message });
    } catch (error) {
        console.error('Error fetching privacy settings:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to fetch privacy settings!', ...channelInfo }, { quoted: message });
    }
}

async function setLastSeenPrivacyCommand(sock, chatId, message, args) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await checkOwnerPermission(sock, chatId, message, senderId)) return;

    const value = args[0]?.toLowerCase();
    const validValues = ['all', 'contacts', 'contact_blacklist', 'none'];
    
    if (!value || !validValues.includes(value)) {
        return await sock.sendMessage(chatId, { 
            text: `❌ Usage: .setlastseen <all|contacts|contact_blacklist|none>`, 
            ...channelInfo 
        }, { quoted: message });
    }

    try {
        await sock.updateLastSeenPrivacy(value);
        await sock.sendMessage(chatId, { text: `✅ Last seen privacy updated to: ${value}`, ...channelInfo }, { quoted: message });
    } catch (error) {
        console.error('Error updating last seen privacy:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to update last seen privacy!', ...channelInfo }, { quoted: message });
    }
}

async function setOnlinePrivacyCommand(sock, chatId, message, args) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await checkOwnerPermission(sock, chatId, message, senderId)) return;

    const value = args[0]?.toLowerCase();
    const validValues = ['all', 'match_last_seen'];
    
    if (!value || !validValues.includes(value)) {
        return await sock.sendMessage(chatId, { 
            text: `❌ Usage: .setonline <all|match_last_seen>`, 
            ...channelInfo 
        }, { quoted: message });
    }

    try {
        await sock.updateOnlinePrivacy(value);
        await sock.sendMessage(chatId, { text: `✅ Online privacy updated to: ${value}`, ...channelInfo }, { quoted: message });
    } catch (error) {
        console.error('Error updating online privacy:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to update online privacy!', ...channelInfo }, { quoted: message });
    }
}

async function setProfilePicPrivacyCommand(sock, chatId, message, args) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await checkOwnerPermission(sock, chatId, message, senderId)) return;

    const value = args[0]?.toLowerCase();
    const validValues = ['all', 'contacts', 'contact_blacklist', 'none'];
    
    if (!value || !validValues.includes(value)) {
        return await sock.sendMessage(chatId, { 
            text: `❌ Usage: .setpfpprivacy <all|contacts|contact_blacklist|none>`, 
            ...channelInfo 
        }, { quoted: message });
    }

    try {
        await sock.updateProfilePicturePrivacy(value);
        await sock.sendMessage(chatId, { text: `✅ Profile picture privacy updated to: ${value}`, ...channelInfo }, { quoted: message });
    } catch (error) {
        console.error('Error updating profile picture privacy:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to update profile picture privacy!', ...channelInfo }, { quoted: message });
    }
}

async function setStatusPrivacyCommand(sock, chatId, message, args) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await checkOwnerPermission(sock, chatId, message, senderId)) return;

    const value = args[0]?.toLowerCase();
    const validValues = ['all', 'contacts', 'contact_blacklist', 'none'];
    
    if (!value || !validValues.includes(value)) {
        return await sock.sendMessage(chatId, { 
            text: `❌ Usage: .setstatusprivacy <all|contacts|contact_blacklist|none>`, 
            ...channelInfo 
        }, { quoted: message });
    }

    try {
        await sock.updateStatusPrivacy(value);
        await sock.sendMessage(chatId, { text: `✅ Status privacy updated to: ${value}`, ...channelInfo }, { quoted: message });
    } catch (error) {
        console.error('Error updating status privacy:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to update status privacy!', ...channelInfo }, { quoted: message });
    }
}

async function setReadReceiptsPrivacyCommand(sock, chatId, message, args) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await checkOwnerPermission(sock, chatId, message, senderId)) return;

    const value = args[0]?.toLowerCase();
    const validValues = ['all', 'none'];
    
    if (!value || !validValues.includes(value)) {
        return await sock.sendMessage(chatId, { 
            text: `❌ Usage: .setreadreceipts <all|none>`, 
            ...channelInfo 
        }, { quoted: message });
    }

    try {
        await sock.updateReadReceiptsPrivacy(value);
        await sock.sendMessage(chatId, { text: `✅ Read receipts privacy updated to: ${value}`, ...channelInfo }, { quoted: message });
    } catch (error) {
        console.error('Error updating read receipts privacy:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to update read receipts privacy!', ...channelInfo }, { quoted: message });
    }
}

async function setGroupsAddPrivacyCommand(sock, chatId, message, args) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await checkOwnerPermission(sock, chatId, message, senderId)) return;

    const value = args[0]?.toLowerCase();
    const validValues = ['all', 'contacts', 'contact_blacklist'];
    
    if (!value || !validValues.includes(value)) {
        return await sock.sendMessage(chatId, { 
            text: `❌ Usage: .setgroupsadd <all|contacts|contact_blacklist>`, 
            ...channelInfo 
        }, { quoted: message });
    }

    try {
        await sock.updateGroupsAddPrivacy(value);
        await sock.sendMessage(chatId, { text: `✅ Groups add privacy updated to: ${value}`, ...channelInfo }, { quoted: message });
    } catch (error) {
        console.error('Error updating groups add privacy:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to update groups add privacy!', ...channelInfo }, { quoted: message });
    }
}

async function setDefaultDisappearingCommand(sock, chatId, message, args) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await checkOwnerPermission(sock, chatId, message, senderId)) return;

    const duration = parseInt(args[0]);
    const validDurations = [0, 86400, 604800, 7776000];
    
    if (isNaN(duration) || !validDurations.includes(duration)) {
        return await sock.sendMessage(chatId, { 
            text: `❌ Usage: .setdefaultdisappearing <0|86400|604800|7776000>\n\n0 = Off\n86400 = 24 hours\n604800 = 7 days\n7776000 = 90 days`, 
            ...channelInfo 
        }, { quoted: message });
    }

    try {
        await sock.updateDefaultDisappearingMode(duration);
        const labels = { 0: 'Off', 86400: '24 hours', 604800: '7 days', 7776000: '90 days' };
        await sock.sendMessage(chatId, { text: `✅ Default disappearing mode set to: ${labels[duration]}`, ...channelInfo }, { quoted: message });
    } catch (error) {
        console.error('Error updating default disappearing mode:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to update default disappearing mode!', ...channelInfo }, { quoted: message });
    }
}

module.exports = {
    blockCommand,
    unblockCommand,
    blocklistCommand,
    getPrivacySettingsCommand,
    setLastSeenPrivacyCommand,
    setOnlinePrivacyCommand,
    setProfilePicPrivacyCommand,
    setStatusPrivacyCommand,
    setReadReceiptsPrivacyCommand,
    setGroupsAddPrivacyCommand,
    setDefaultDisappearingCommand
};
