const axios = require('axios');
const settings = require('../settings');

const BACKEND_URL = settings.backendApiUrl || 'http://0.0.0.0:5000';

async function delBotCommand(sock, chatId, message, args) {
    if (args.length < 1) {
        return await sock.sendMessage(chatId, { text: 'Usage: .delbot <phone_number>' }, { quoted: message });
    }
    
    const phoneNumber = args[0].replace(/[^0-9]/g, '');
    
    try {
        const lookup = await axios.get(`${BACKEND_URL}/api/instances/by-phone/${phoneNumber}`);
        if (!lookup.data?.id) {
            return await sock.sendMessage(chatId, { text: `❌ Bot not found: ${phoneNumber}` }, { quoted: message });
        }
        
        await axios.delete(`${BACKEND_URL}/api/instances/${lookup.data.id}`);
        
        await sock.sendMessage(chatId, { 
            text: `✅ *Bot Deleted*\n\nPhone: ${phoneNumber}\nID: \`${lookup.data.id}\`\nhas been removed from the database.` 
        }, { quoted: message });
    } catch (error) {
        await sock.sendMessage(chatId, { text: `❌ Error: ${error.message}` }, { quoted: message });
    }
}

module.exports = delBotCommand;