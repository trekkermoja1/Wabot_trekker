const axios = require('axios');
const settings = require('../settings');

const BACKEND_URL = settings.backendApiUrl || 'http://0.0.0.0:5000';

async function searchBotCommand(sock, chatId, message, args) {
    if (args.length < 1) {
        return await sock.sendMessage(chatId, { text: 'Usage: .searchbot <phone_number>' }, { quoted: message });
    }
    
    const phoneNumber = args[0].replace(/[^0-9]/g, '');
    try {
        const response = await axios.get(`${BACKEND_URL}/api/instances/by-phone/${phoneNumber}`);
        const bot = response.data;
        
        if (!bot || !bot.id) {
            return await sock.sendMessage(chatId, { text: `❌ No bot found with phone number: ${phoneNumber}` }, { quoted: message });
        }
        
        let text = `🔍 *Bot Search Results*\n\n`;
        text += `📱 *Phone:* ${bot.phone_number}\n`;
        text += `🆔 *ID:* \`${bot.id}\`\n`;
        text += `🌍 *Server:* ${bot.server_name || 'N/A'}\n`;
        text += `⏱️ *Last Active:* ${bot.last_active ? new Date(bot.last_active).toLocaleString() : 'Never'}\n`;
        text += `✅ *Status:* ${bot.status}\n`;
        text += `⚙️ *Features:* ${bot.enabled_features ? bot.enabled_features.join(', ') : 'Default'}\n`;
        
        await sock.sendMessage(chatId, { text }, { quoted: message });
    } catch (error) {
        await sock.sendMessage(chatId, { text: `❌ Error: ${error.message}` }, { quoted: message });
    }
}

module.exports = searchBotCommand;