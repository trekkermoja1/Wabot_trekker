/**
 * Bot Management Commands for Sudo User
 * Commands: .approve, .newbots, .expiredbots
 */
const axios = require('axios');
const settings = require('../settings');

const BACKEND_URL = settings.backendApiUrl;
const SUDO_NUMBER = settings.sudoNumber + '@s.whatsapp.net';

// Check if user is sudo
function isSudo(senderId) {
    return senderId === SUDO_NUMBER;
}

/**
 * .approve command - Approve a new bot
 * Usage: .approve <bot_id> <duration_months>
 * Example: .approve abc123 3
 */
async function approveCommand(sock, chatId, message, args) {
    const senderId = message.key.participant || message.key.remoteJid;
    
    if (!isSudo(senderId)) {
        await sock.sendMessage(chatId, {
            text: '❌ This command is only available for sudo user (254704897825)'
        }, { quoted: message });
        return;
    }
    
    if (args.length < 2) {
        await sock.sendMessage(chatId, {
            text: `*Bot Approval*\n\nUsage: .approve <bot_id> <duration>\n\nDuration options: 1, 2, 3, 6, 12 (months)\n\nExample: .approve abc123 3`
        }, { quoted: message });
        return;
    }
    
    const botId = args[0];
    const durationMonths = parseInt(args[1]);
    
    if (![1, 2, 3, 6, 12].includes(durationMonths)) {
        await sock.sendMessage(chatId, {
            text: '❌ Invalid duration. Choose from: 1, 2, 3, 6, or 12 months'
        }, { quoted: message });
        return;
    }
    
    try {
        const response = await axios.post(
            `${BACKEND_URL}/api/instances/${botId}/approve`,
            { duration_months: durationMonths }
        );
        
        const data = response.data;
        const expiresAt = new Date(data.expires_at).toLocaleString();
        
        await sock.sendMessage(chatId, {
            text: `✅ *Bot Approved!*\n\n` +
                  `Bot ID: ${data.instance_id}\n` +
                  `Duration: ${data.duration_months} month(s)\n` +
                  `Port: ${data.port}\n` +
                  `Expires: ${expiresAt}\n\n` +
                  `Bot is now running and moved to approved bots.`
        }, { quoted: message });
    } catch (error) {
        console.error('Error approving bot:', error);
        const errorMsg = error.response?.data?.detail || error.message;
        await sock.sendMessage(chatId, {
            text: `❌ *Approval Failed*\n\n${errorMsg}`
        }, { quoted: message });
    }
}

/**
 * .newbots command - List all new bots awaiting approval
 */
async function newBotsCommand(sock, chatId, message) {
    const senderId = message.key.participant || message.key.remoteJid;
    
    if (!isSudo(senderId)) {
        await sock.sendMessage(chatId, {
            text: '❌ This command is only available for sudo user (254704897825)'
        }, { quoted: message });
        return;
    }
    
    try {
        const response = await axios.get(`${BACKEND_URL}/api/instances?status=new`);
        const bots = response.data.instances;
        
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
        
        await sock.sendMessage(chatId, {
            text: text
        }, { quoted: message });
    } catch (error) {
        console.error('Error fetching new bots:', error);
        await sock.sendMessage(chatId, {
            text: `❌ *Error*\n\n${error.message}`
        }, { quoted: message });
    }
}

/**
 * .expiredbots command - List all expired bots
 */
async function expiredBotsCommand(sock, chatId, message) {
    const senderId = message.key.participant || message.key.remoteJid;
    
    if (!isSudo(senderId)) {
        await sock.sendMessage(chatId, {
            text: '❌ This command is only available for sudo user (254704897825)'
        }, { quoted: message });
        return;
    }
    
    try {
        const response = await axios.get(`${BACKEND_URL}/api/instances?status=expired`);
        const bots = response.data.instances;
        
        if (bots.length === 0) {
            await sock.sendMessage(chatId, {
                text: '📋 *Expired Bots*\n\nNo expired bots.'
            }, { quoted: message });
            return;
        }
        
        let text = `📋 *Expired Bots (${bots.length})*\n\n`;
        
        bots.forEach((bot, index) => {
            const expiredAt = new Date(bot.expires_at).toLocaleString();
            text += `${index + 1}. *${bot.name}*\n`;
            text += `   ID: \`${bot.id}\`\n`;
            text += `   Phone: ${bot.phone_number}\n`;
            text += `   Expired: ${expiredAt}\n`;
            text += `   Last Duration: ${bot.duration_months} month(s)\n`;
            text += `   Server: ${bot.server_name}\n\n`;
        });
        
        text += `\n💡 These bots need renewal to restart.`;
        
        await sock.sendMessage(chatId, {
            text: text
        }, { quoted: message });
    } catch (error) {
        console.error('Error fetching expired bots:', error);
        await sock.sendMessage(chatId, {
            text: `❌ *Error*\n\n${error.message}`
        }, { quoted: message });
    }
}

module.exports = {
    approveCommand,
    newBotsCommand,
    expiredBotsCommand,
    isSudo
};
