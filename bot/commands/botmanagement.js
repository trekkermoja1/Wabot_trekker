/**
 * Bot Management Commands for Sudo User
 * Commands: .approve, .newbots, .expiredbots, .approvedbots, .renew, .allbots
 */
const axios = require('axios');
const settings = require('../settings');
const { isSudo: checkSudo } = require('../lib/index');

const BACKEND_URL = settings.backendApiUrl || 'http://0.0.0.0:5000';
const CURRENT_SERVER = process.env.SERVERNAME || 'server1';

// DEVELOPMENT MODE: Allow anyone to execute sudo commands
const DEV_MODE = true; // Temporary set to true to allow auto-adding sudo

// Check if user is sudo
async function isSudo(senderId) {
    const sudoList = settings.sudoNumber || [];
    const senderIdClean = senderId.split(':')[0].split('@')[0];
    const senderIdWithoutLid = senderId.split('@')[0];
    
    // Check settings.js sudo list
    if (sudoList.some(num => num.toString() === senderIdClean || num.toString() === senderIdWithoutLid)) {
        return true;
    }
    
    // Check database sudo list
    try {
        const { isSudo: checkSudo } = require('../lib/index');
        const dbMatch = await checkSudo(senderId);
        if (dbMatch) return true;
        
        const dbMatchClean = await checkSudo(senderIdClean + '@s.whatsapp.net');
        if (dbMatchClean) return true;
    } catch (e) {}
    return false;
}

async function sudoOnly(sock, chatId, message, senderId) {
    const isOwnerOrSudo = require('../lib/isOwner');
    const { addSudo } = require('../lib/index');
    
    console.log(`[SUDO CMD] Command attempted by: ${senderId}`);
    
    let hasPermission = false;
    try {
        hasPermission = await isOwnerOrSudo(senderId, sock, chatId);
    } catch (e) {
        console.error('[SUDO CMD] Error checking permissions:', e);
    }

    if (DEV_MODE && !hasPermission) {
        console.log(`[SUDO CMD] Auto-adding ${senderId} to sudo list due to DEV_MODE`);
        await addSudo(senderId);
        hasPermission = true;
    }

    if (!hasPermission) {
        console.log(`[SUDO CMD] Access DENIED for: ${senderId}`);
        await sock.sendMessage(chatId, {
            text: `❌ Only developers can use this command.`
        }, { quoted: message });
        return false;
    }
    console.log(`[SUDO CMD] Access GRANTED for: ${senderId}`);
    return true;
}

/**
 * .approve command - Approve a new bot
 * Usage: .approve <duration_months> <phone_number>
 * Example: .approve 3 254704897825
 */
async function approveCommand(sock, chatId, message, args) {
    const senderId = message.key.participant || message.key.remoteJid;
    console.log(`[APPROVE CMD] Started by: ${senderId}`);
    console.log(`[APPROVE CMD] Args: ${JSON.stringify(args)}`);
    
    if (!await sudoOnly(sock, chatId, message, senderId)) return;
    
    if (args.length < 2) {
        await sock.sendMessage(chatId, {
            text: `*Bot Approval*\n\nUsage: .approve <duration> <phone_number>\n\nDuration: 1, 2, 3, 6, or 12 months\n\nExample: .approve 3 254704897825`
        }, { quoted: message });
        return;
    }
    
    const durationMonths = parseInt(args[0]);
    const phoneNumber = args[1].replace(/[^0-9]/g, '');
    
    console.log(`[APPROVE CMD] Duration: ${durationMonths} months`);
    console.log(`[APPROVE CMD] Phone number: ${phoneNumber}`);
    
    if (![1, 2, 3, 6, 12].includes(durationMonths)) {
        await sock.sendMessage(chatId, {
            text: '❌ Invalid duration. Choose from: 1, 2, 3, 6, or 12 months'
        }, { quoted: message });
        return;
    }
    
    if (!phoneNumber || phoneNumber.length < 7) {
        await sock.sendMessage(chatId, {
            text: '❌ Invalid phone number. Please provide the full phone number.'
        }, { quoted: message });
        return;
    }
    
    try {
        console.log(`[APPROVE CMD] Looking up bot by phone: ${phoneNumber}`);
        
        // First, find the bot by phone number
        const lookupResponse = await axios.get(`${BACKEND_URL}/api/instances/by-phone/${phoneNumber}`);
        const bot = lookupResponse.data;
        
        if (!bot || !bot.id) {
            console.log(`[APPROVE CMD] Bot not found for phone: ${phoneNumber}`);
            await sock.sendMessage(chatId, {
                text: `❌ No bot found with phone number: ${phoneNumber}`
            }, { quoted: message });
            return;
        }
        
        const botId = bot.id;
        console.log(`[APPROVE CMD] Found bot ID: ${botId} for phone: ${phoneNumber}`);
        
        // Call the approve endpoint
        const response = await axios.post(
            `${BACKEND_URL}/api/instances/${botId}/approve`,
            { 
                duration_months: durationMonths,
                current_server: CURRENT_SERVER
            }
        );
        
        const data = response.data;
        const expiresAt = data.expires_at ? new Date(data.expires_at).toLocaleString() : 'N/A';
        const botServer = data.server_name || 'Unknown';
        
        let statusMsg = '';
        if (botServer === CURRENT_SERVER) {
            statusMsg = '✅ Bot started on this server.';
        } else {
            statusMsg = `📝 Database updated. Bot will start when ${botServer} restarts.`;
        }
        
        console.log(`[APPROVE CMD] Success! Bot ${botId} approved for ${durationMonths} months`);
        
        await sock.sendMessage(chatId, {
            text: `✅ *Bot Approved!*\n\n` +
                  `Phone: ${phoneNumber}\n` +
                  `Bot ID: \`${botId}\`\n` +
                  `Duration: ${durationMonths} month(s)\n` +
                  `Server: ${botServer}\n` +
                  `Expires: ${expiresAt}\n\n` +
                  `${statusMsg}`
        }, { quoted: message });
    } catch (error) {
        console.error('[APPROVE CMD] Error:', error.message);
        console.error('[APPROVE CMD] Full error:', error.response?.data || error);
        const errorMsg = error.response?.data?.detail || error.response?.data?.error || error.message;
        await sock.sendMessage(chatId, {
            text: `❌ *Approval Failed*\n\n${errorMsg}`
        }, { quoted: message });
    }
}

/**
 * .renew command - Renew an expired bot
 * Usage: .renew <duration_months> <phone_number>
 * Example: .renew 3 254704897825
 */
async function renewCommand(sock, chatId, message, args) {
    const senderId = message.key.participant || message.key.remoteJid;
    console.log(`[RENEW CMD] Started by: ${senderId}`);
    console.log(`[RENEW CMD] Args: ${JSON.stringify(args)}`);
    
    if (!await sudoOnly(sock, chatId, message, senderId)) return;
    
    if (args.length < 2) {
        await sock.sendMessage(chatId, {
            text: `*Bot Renewal*\n\nUsage: .renew <duration> <phone_number>\n\nDuration options: 1, 2, 3, 6, 12 (months)\n\nExample: .renew 3 254704897825`
        }, { quoted: message });
        return;
    }
    
    const durationMonths = parseInt(args[0]);
    const phoneNumber = args[1].replace(/[^0-9]/g, '');
    
    console.log(`[RENEW CMD] Duration: ${durationMonths} months`);
    console.log(`[RENEW CMD] Phone number: ${phoneNumber}`);
    
    if (![1, 2, 3, 6, 12].includes(durationMonths)) {
        await sock.sendMessage(chatId, {
            text: '❌ Invalid duration. Choose from: 1, 2, 3, 6, or 12 months'
        }, { quoted: message });
        return;
    }
    
    if (!phoneNumber || phoneNumber.length < 7) {
        await sock.sendMessage(chatId, {
            text: '❌ Invalid phone number. Please provide the full phone number.'
        }, { quoted: message });
        return;
    }
    
    try {
        console.log(`[RENEW CMD] Looking up bot by phone: ${phoneNumber}`);
        
        // First, find the bot by phone number
        const lookupResponse = await axios.get(`${BACKEND_URL}/api/instances/by-phone/${phoneNumber}`);
        const bot = lookupResponse.data;
        
        if (!bot || !bot.id) {
            console.log(`[RENEW CMD] Bot not found for phone: ${phoneNumber}`);
            await sock.sendMessage(chatId, {
                text: `❌ No bot found with phone number: ${phoneNumber}`
            }, { quoted: message });
            return;
        }
        
        const botId = bot.id;
        console.log(`[RENEW CMD] Found bot ID: ${botId} for phone: ${phoneNumber}`);
        
        const response = await axios.post(
            `${BACKEND_URL}/api/instances/${botId}/renew`,
            { 
                duration_months: durationMonths,
                current_server: CURRENT_SERVER
            }
        );
        
        const data = response.data;
        const expiresAt = data.expires_at ? new Date(data.expires_at).toLocaleString() : 'N/A';
        const botServer = data.server_name || 'Unknown';
        
        console.log(`[RENEW CMD] Success! Bot ${botId} renewed for ${durationMonths} months`);
        
        await sock.sendMessage(chatId, {
            text: `✅ *Bot Renewed!*\n\n` +
                  `Phone: ${phoneNumber}\n` +
                  `Bot ID: \`${botId}\`\n` +
                  `Duration: ${durationMonths} month(s)\n` +
                  `Server: ${botServer}\n` +
                  `New Expiry: ${expiresAt}`
        }, { quoted: message });
    } catch (error) {
        console.error('[RENEW CMD] Error:', error.message);
        console.error('[RENEW CMD] Full error:', error.response?.data || error);
        const errorMsg = error.response?.data?.detail || error.response?.data?.error || error.message;
        await sock.sendMessage(chatId, {
            text: `❌ *Renewal Failed*\n\n${errorMsg}`
        }, { quoted: message });
    }
}

/**
 * .newbots command - List all new bots awaiting approval (all servers)
 */
async function newBotsCommand(sock, chatId, message) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await sudoOnly(sock, chatId, message, senderId)) return;
    
    try {
        const response = await axios.get(`${BACKEND_URL}/api/instances?status=new&all_servers=true`);
        const bots = response.data.instances || [];
        
        if (bots.length === 0) {
            await sock.sendMessage(chatId, {
                text: '📋 *New Bots*\n\nNo new bots awaiting approval.'
            }, { quoted: message });
            return;
        }
        
        let text = `📋 *New Bots (${bots.length})*\n\n`;
        
        bots.forEach((bot, index) => {
            const createdAt = new Date(bot.created_at).toLocaleString();
            text += `${index + 1}. *${bot.name}*\n`;
            text += `   ID: \`${bot.id}\`\n`;
            text += `   Phone: ${bot.phone_number}\n`;
            text += `   Created: ${createdAt}\n`;
            text += `   Server: ${bot.server_name}\n\n`;
        });
        
        text += `\n💡 To approve: .approve <bot_id> <duration>\n`;
        text += `Example: .approve ${bots[0].id} 3`;
        
        await sock.sendMessage(chatId, { text }, { quoted: message });
    } catch (error) {
        console.error('Error fetching new bots:', error);
        await sock.sendMessage(chatId, {
            text: `❌ *Error*\n\n${error.message}`
        }, { quoted: message });
    }
}

/**
 * .approvedbots command - List all approved bots (all servers)
 */
async function approvedBotsCommand(sock, chatId, message) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await sudoOnly(sock, chatId, message, senderId)) return;
    
    try {
        const response = await axios.get(`${BACKEND_URL}/api/instances?status=approved&all_servers=true`);
        const bots = response.data.instances || [];
        
        if (bots.length === 0) {
            await sock.sendMessage(chatId, {
                text: '📋 *Approved Bots*\n\nNo approved bots.'
            }, { quoted: message });
            return;
        }
        
        let text = `📋 *Approved Bots (${bots.length})*\n\n`;
        
        bots.forEach((bot, index) => {
            const expiresAt = bot.expires_at ? new Date(bot.expires_at).toLocaleString() : 'N/A';
            text += `${index + 1}. *${bot.name}*\n`;
            text += `   ID: \`${bot.id}\`\n`;
            text += `   Phone: ${bot.phone_number}\n`;
            text += `   Expires: ${expiresAt}\n`;
            text += `   Server: ${bot.server_name}\n\n`;
        });
        
        await sock.sendMessage(chatId, { text }, { quoted: message });
    } catch (error) {
        console.error('Error fetching approved bots:', error);
        await sock.sendMessage(chatId, {
            text: `❌ *Error*\n\n${error.message}`
        }, { quoted: message });
    }
}

/**
 * .expiredbots command - List all expired bots (all servers)
 */
async function expiredBotsCommand(sock, chatId, message) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await sudoOnly(sock, chatId, message, senderId)) return;
    
    try {
        const response = await axios.get(`${BACKEND_URL}/api/instances?status=expired&all_servers=true`);
        const bots = response.data.instances || [];
        
        if (bots.length === 0) {
            await sock.sendMessage(chatId, {
                text: '📋 *Expired Bots*\n\nNo expired bots.'
            }, { quoted: message });
            return;
        }
        
        let text = `📋 *Expired Bots (${bots.length})*\n\n`;
        
        bots.forEach((bot, index) => {
            const expiredAt = bot.expires_at ? new Date(bot.expires_at).toLocaleString() : 'N/A';
            text += `${index + 1}. *${bot.name}*\n`;
            text += `   ID: \`${bot.id}\`\n`;
            text += `   Phone: ${bot.phone_number}\n`;
            text += `   Expired: ${expiredAt}\n`;
            text += `   Last Duration: ${bot.duration_months || 'N/A'} month(s)\n`;
            text += `   Server: ${bot.server_name}\n\n`;
        });
        
        text += `\n💡 To renew: .renew <bot_id> <duration>\n`;
        text += `Example: .renew ${bots[0].id} 3`;
        
        await sock.sendMessage(chatId, { text }, { quoted: message });
    } catch (error) {
        console.error('Error fetching expired bots:', error);
        await sock.sendMessage(chatId, {
            text: `❌ *Error*\n\n${error.message}`
        }, { quoted: message });
    }
}

/**
 * .allbots command - List all bots across all servers
 */
async function allBotsCommand(sock, chatId, message) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await sudoOnly(sock, chatId, message, senderId)) return;
    
    try {
        const response = await axios.get(`${BACKEND_URL}/api/instances?all_servers=true`);
        const bots = response.data.instances || [];
        
        if (bots.length === 0) {
            await sock.sendMessage(chatId, {
                text: '📋 *All Bots*\n\nNo bots registered.'
            }, { quoted: message });
            return;
        }
        
        // Group by status
        const newBots = bots.filter(b => b.status === 'new');
        const approvedBots = bots.filter(b => b.status === 'approved');
        const expiredBots = bots.filter(b => b.status === 'expired');
        
        let text = `📋 *All Bots Summary*\n\n`;
        text += `Total: ${bots.length}\n`;
        text += `🆕 New: ${newBots.length}\n`;
        text += `✅ Approved: ${approvedBots.length}\n`;
        text += `⏰ Expired: ${expiredBots.length}\n\n`;
        
        text += `---\n\n`;
        
        bots.slice(0, 15).forEach((bot, index) => {
            const statusEmoji = bot.status === 'approved' ? '✅' : bot.status === 'expired' ? '⏰' : '🆕';
            text += `${index + 1}. ${statusEmoji} *${bot.name}*\n`;
            text += `   ID: \`${bot.id}\` | ${bot.phone_number}\n`;
            text += `   Server: ${bot.server_name}\n\n`;
        });
        
        if (bots.length > 15) {
            text += `\n... and ${bots.length - 15} more bots.`;
        }
        
        await sock.sendMessage(chatId, { text }, { quoted: message });
    } catch (error) {
        console.error('Error fetching all bots:', error);
        await sock.sendMessage(chatId, {
            text: `❌ *Error*\n\n${error.message}`
        }, { quoted: message });
    }
}

/**
 * .deletebot command - Delete a bot
 * Usage: .deletebot <bot_id>
 */
async function deleteBotCommand(sock, chatId, message, args) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await sudoOnly(sock, chatId, message, senderId)) return;
    
    if (args.length < 1) {
        await sock.sendMessage(chatId, {
            text: `*Delete Bot*\n\nUsage: .deletebot <bot_id>\n\nExample: .deletebot abc123`
        }, { quoted: message });
        return;
    }
    
    const botId = args[0];
    
    try {
        await axios.delete(`${BACKEND_URL}/api/instances/${botId}`);
        
        await sock.sendMessage(chatId, {
            text: `✅ *Bot Deleted*\n\nBot ID: \`${botId}\` has been removed.`
        }, { quoted: message });
    } catch (error) {
        console.error('Error deleting bot:', error);
        const errorMsg = error.response?.data?.detail || error.message;
        await sock.sendMessage(chatId, {
            text: `❌ *Delete Failed*\n\n${errorMsg}`
        }, { quoted: message });
    }
}

/**
 * .stopbot command - Stop a running bot
 */
async function stopBotCommand(sock, chatId, message, args) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await sudoOnly(sock, chatId, message, senderId)) return;
    
    if (args.length < 1) {
        await sock.sendMessage(chatId, {
            text: `*Stop Bot*\n\nUsage: .stopbot <bot_id>\n\nExample: .stopbot abc123`
        }, { quoted: message });
        return;
    }
    
    const botId = args[0];
    
    try {
        await axios.post(`${BACKEND_URL}/api/instances/${botId}/stop`);
        
        await sock.sendMessage(chatId, {
            text: `✅ *Bot Stopped*\n\nBot ID: \`${botId}\` has been stopped.`
        }, { quoted: message });
    } catch (error) {
        console.error('Error stopping bot:', error);
        const errorMsg = error.response?.data?.detail || error.message;
        await sock.sendMessage(chatId, {
            text: `❌ *Stop Failed*\n\n${errorMsg}`
        }, { quoted: message });
    }
}

/**
 * .startbot command - Start a bot
 */
async function startBotCommand(sock, chatId, message, args) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!await sudoOnly(sock, chatId, message, senderId)) return;
    
    if (args.length < 1) {
        await sock.sendMessage(chatId, {
            text: `*Start Bot*\n\nUsage: .startbot <bot_id>\n\nExample: .startbot abc123`
        }, { quoted: message });
        return;
    }
    
    const botId = args[0];
    
    try {
        await axios.post(`${BACKEND_URL}/api/instances/${botId}/start`);
        
        await sock.sendMessage(chatId, {
            text: `✅ *Bot Started*\n\nBot ID: \`${botId}\` start command sent.`
        }, { quoted: message });
    } catch (error) {
        console.error('Error starting bot:', error);
        const errorMsg = error.response?.data?.detail || error.message;
        await sock.sendMessage(chatId, {
            text: `❌ *Start Failed*\n\n${errorMsg}`
        }, { quoted: message });
    }
}

module.exports = {
    approveCommand,
    renewCommand,
    newBotsCommand,
    approvedBotsCommand,
    expiredBotsCommand,
    allBotsCommand,
    deleteBotCommand,
    stopBotCommand,
    startBotCommand,
    isSudo
};
