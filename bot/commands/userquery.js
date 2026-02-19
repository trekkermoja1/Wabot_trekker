const { isSudo } = require('../lib/index');
const isOwnerOrSudo = require('../lib/isOwner');
const { channelInfo } = require('../lib/messageConfig');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');

async function checkOwnerPermission(sock, chatId, message, senderId) {
    const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
    const senderIsSudo = await isSudo(senderId);
    if (!message.key.fromMe && !isOwner && !senderIsSudo) {
        await sock.sendMessage(chatId, { text: '❌ Only owner/sudo can use this command.', ...channelInfo }, { quoted: message });
        return false;
    }
    return true;
}

function extractTarget(message, args, chatId) {
    let targetJid;
    
    if (message.message?.extendedTextMessage?.contextInfo?.participant) {
        targetJid = message.message.extendedTextMessage.contextInfo.participant;
    } else if (message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
        targetJid = message.message.extendedTextMessage.contextInfo.mentionedJid[0];
    } else if (args.length > 0) {
        const number = args.join('').replace(/[^0-9]/g, '');
        if (number.length >= 7) {
            targetJid = number + '@s.whatsapp.net';
        }
    } else if (!chatId.endsWith('@g.us')) {
        targetJid = chatId;
    }
    
    return targetJid;
}

async function checkNumberCommand(sock, chatId, message, args) {
    const targetJid = extractTarget(message, args, chatId);
    
    if (!targetJid) {
        return await sock.sendMessage(chatId, { 
            text: '❌ Usage: .checknumber <number>\nExample: .checknumber 254712345678', 
            ...channelInfo 
        }, { quoted: message });
    }

    try {
        const [result] = await sock.onWhatsApp(targetJid.replace('@s.whatsapp.net', ''));
        if (result?.exists) {
            await sock.sendMessage(chatId, { 
                text: `✅ @${targetJid.split('@')[0]} exists on WhatsApp!\n\nJID: ${result.jid}`,
                mentions: [targetJid],
                ...channelInfo 
            }, { quoted: message });
        } else {
            await sock.sendMessage(chatId, { 
                text: `❌ Number ${targetJid.split('@')[0]} is NOT registered on WhatsApp.`,
                ...channelInfo 
            }, { quoted: message });
        }
    } catch (error) {
        console.error('Error checking number:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to check number!', ...channelInfo }, { quoted: message });
    }
}

async function fetchStatusCommand(sock, chatId, message, args) {
    const targetJid = extractTarget(message, args, chatId);
    
    if (!targetJid) {
        return await sock.sendMessage(chatId, { 
            text: '❌ Usage: .fetchstatus @user or .fetchstatus <number>', 
            ...channelInfo 
        }, { quoted: message });
    }

    try {
        const status = await sock.fetchStatus(targetJid);
        if (status) {
            const setAt = status.setAt ? new Date(status.setAt * 1000).toLocaleString() : 'Unknown';
            await sock.sendMessage(chatId, { 
                text: `📝 *Status of @${targetJid.split('@')[0]}*\n\n${status.status || 'No status'}\n\n📅 Set at: ${setAt}`,
                mentions: [targetJid],
                ...channelInfo 
            }, { quoted: message });
        } else {
            await sock.sendMessage(chatId, { 
                text: `❌ No status found for @${targetJid.split('@')[0]}`,
                mentions: [targetJid],
                ...channelInfo 
            }, { quoted: message });
        }
    } catch (error) {
        console.error('Error fetching status:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to fetch status! User may have privacy enabled.', ...channelInfo }, { quoted: message });
    }
}

async function fetchProfilePicCommand(sock, chatId, message, args) {
    let targetJid = extractTarget(message, args, chatId);
    
    if (!targetJid && chatId.endsWith('@g.us')) {
        targetJid = chatId;
    }
    
    if (!targetJid) {
        return await sock.sendMessage(chatId, { 
            text: '❌ Usage: .getpp @user or .getpp (in group for group pic)', 
            ...channelInfo 
        }, { quoted: message });
    }

    try {
        const ppUrl = await sock.profilePictureUrl(targetJid, 'image');
        if (ppUrl) {
            await sock.sendMessage(chatId, { 
                image: { url: ppUrl },
                caption: `🖼️ Profile picture of ${targetJid.endsWith('@g.us') ? 'this group' : '@' + targetJid.split('@')[0]}`,
                mentions: targetJid.endsWith('@g.us') ? [] : [targetJid],
                ...channelInfo 
            }, { quoted: message });
        } else {
            await sock.sendMessage(chatId, { text: '❌ No profile picture found or privacy is enabled.', ...channelInfo }, { quoted: message });
        }
    } catch (error) {
        console.error('Error fetching profile picture:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to fetch profile picture! Privacy may be enabled.', ...channelInfo }, { quoted: message });
    }
}

async function fetchBusinessProfileCommand(sock, chatId, message, args) {
    const targetJid = extractTarget(message, args, chatId);
    
    if (!targetJid) {
        return await sock.sendMessage(chatId, { 
            text: '❌ Usage: .bizprofile @user or .bizprofile <number>', 
            ...channelInfo 
        }, { quoted: message });
    }

    try {
        const profile = await sock.getBusinessProfile(targetJid);
        if (profile) {
            let text = `💼 *Business Profile of @${targetJid.split('@')[0]}*\n\n`;
            text += `📝 Description: ${profile.description || 'N/A'}\n`;
            text += `🏷️ Category: ${profile.category || 'N/A'}\n`;
            text += `📧 Email: ${profile.email || 'N/A'}\n`;
            text += `🌐 Website: ${profile.website?.join(', ') || 'N/A'}\n`;
            text += `📍 Address: ${profile.address || 'N/A'}\n`;
            
            await sock.sendMessage(chatId, { 
                text,
                mentions: [targetJid],
                ...channelInfo 
            }, { quoted: message });
        } else {
            await sock.sendMessage(chatId, { text: '❌ No business profile found or this is not a business account.', ...channelInfo }, { quoted: message });
        }
    } catch (error) {
        console.error('Error fetching business profile:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to fetch business profile!', ...channelInfo }, { quoted: message });
    }
}

async function fetchUserStatusCommand(sock, chatId, message, args) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await checkOwnerPermission(sock, chatId, message, senderId)) return;

    const targetJid = extractTarget(message, args, chatId);
    
    if (!targetJid) {
        return await sock.sendMessage(chatId, { 
            text: '❌ Usage: .userstatus @user or .userstatus <number>', 
            ...channelInfo 
        }, { quoted: message });
    }

    try {
        await sock.presenceSubscribe(targetJid);
        await sock.sendMessage(chatId, { 
            text: `✅ Now tracking presence of @${targetJid.split('@')[0]}. Check console for updates.`,
            mentions: [targetJid],
            ...channelInfo 
        }, { quoted: message });
    } catch (error) {
        console.error('Error subscribing to presence:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to subscribe to presence!', ...channelInfo }, { quoted: message });
    }
}

async function setMyStatusCommand(sock, chatId, message, args) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await checkOwnerPermission(sock, chatId, message, senderId)) return;

    const status = args.join(' ');
    if (!status) {
        return await sock.sendMessage(chatId, { text: '❌ Usage: .setmystatus <new status text>', ...channelInfo }, { quoted: message });
    }

    try {
        await sock.updateProfileStatus(status);
        await sock.sendMessage(chatId, { text: `✅ Profile status updated to: "${status}"`, ...channelInfo }, { quoted: message });
    } catch (error) {
        console.error('Error updating profile status:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to update profile status!', ...channelInfo }, { quoted: message });
    }
}

async function setMyNameCommand(sock, chatId, message, args) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await checkOwnerPermission(sock, chatId, message, senderId)) return;

    const name = args.join(' ');
    if (!name) {
        return await sock.sendMessage(chatId, { text: '❌ Usage: .setmyname <new name>', ...channelInfo }, { quoted: message });
    }

    try {
        await sock.updateProfileName(name);
        await sock.sendMessage(chatId, { text: `✅ Profile name updated to: "${name}"`, ...channelInfo }, { quoted: message });
    } catch (error) {
        console.error('Error updating profile name:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to update profile name!', ...channelInfo }, { quoted: message });
    }
}

async function removeMyPicCommand(sock, chatId, message) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await checkOwnerPermission(sock, chatId, message, senderId)) return;

    try {
        await sock.removeProfilePicture(sock.user.id);
        await sock.sendMessage(chatId, { text: '✅ Profile picture removed!', ...channelInfo }, { quoted: message });
    } catch (error) {
        console.error('Error removing profile picture:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to remove profile picture!', ...channelInfo }, { quoted: message });
    }
}

async function getDeviceCommand(sock, chatId, message, args) {
    const quotedMsg = message.message?.extendedTextMessage?.contextInfo;
    
    if (!quotedMsg?.stanzaId) {
        return await sock.sendMessage(chatId, { text: '❌ Please reply to a message to check its device!', ...channelInfo }, { quoted: message });
    }

    try {
        const { getDevice } = require('@whiskeysockets/baileys');
        const device = getDevice(quotedMsg.stanzaId);
        const deviceNames = {
            'android': '📱 Android',
            'ios': '🍎 iOS',
            'web': '🌐 WhatsApp Web',
            'desktop': '💻 Desktop',
            'unknown': '❓ Unknown'
        };
        
        await sock.sendMessage(chatId, { 
            text: `📱 *Device Info*\n\nThis message was sent from: ${deviceNames[device] || device}`,
            ...channelInfo 
        }, { quoted: message });
    } catch (error) {
        console.error('Error getting device:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to get device info!', ...channelInfo }, { quoted: message });
    }
}

async function jidInfoCommand(sock, chatId, message, args) {
    const targetJid = extractTarget(message, args, chatId);
    
    if (!targetJid) {
        const botJid = sock.user?.id || 'unknown';
        await sock.sendMessage(chatId, { 
            text: `📋 *Bot JID Info*\n\nBot JID: ${botJid}\nChat JID: ${chatId}`,
            ...channelInfo 
        }, { quoted: message });
        return;
    }

    await sock.sendMessage(chatId, { 
        text: `📋 *JID Info*\n\nUser: @${targetJid.split('@')[0]}\nFull JID: ${targetJid}`,
        mentions: [targetJid],
        ...channelInfo 
    }, { quoted: message });
}

module.exports = {
    checkNumberCommand,
    fetchStatusCommand,
    fetchProfilePicCommand,
    fetchBusinessProfileCommand,
    fetchUserStatusCommand,
    setMyStatusCommand,
    setMyNameCommand,
    removeMyPicCommand,
    getDeviceCommand,
    jidInfoCommand
};
