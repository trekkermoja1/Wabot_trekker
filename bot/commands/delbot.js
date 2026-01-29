const axios = require('axios');
const settings = require('../settings');

const BACKEND_URL = settings.backendApiUrl || 'http://0.0.0.0:5000';

async function callBackend(method, endpoint, data = null) {
    const hosts = ['0.0.0.0', '127.0.0.1', 'localhost'];
    let lastError;
    for (const host of hosts) {
        try {
            const url = BACKEND_URL.replace(/0\.0\.0\.0|127\.0\.0\.1|localhost/, host);
            const config = { method, url: `${url}${endpoint}`, data };
            return await axios(config);
        } catch (e) {
            lastError = e;
        }
    }
    throw lastError;
}

async function delBotCommand(sock, chatId, message, args) {
    if (args.length < 1) {
        return await sock.sendMessage(chatId, { text: 'Usage: .delbot <phone_number>' }, { quoted: message });
    }
    
    const phoneNumber = args[0].replace(/[^0-9]/g, '');
    
    try {
        const lookup = await callBackend('get', `/api/instances/by-phone/${phoneNumber}`);
        if (!lookup.data?.id) {
            return await sock.sendMessage(chatId, { text: `❌ Bot not found: ${phoneNumber}` }, { quoted: message });
        }
        
        await callBackend('delete', `/api/instances/${lookup.data.id}`);
        
        await sock.sendMessage(chatId, { 
            text: `✅ *Bot Deleted*\n\nPhone: ${phoneNumber}\nID: \`${lookup.data.id}\`\nhas been removed from the database.` 
        }, { quoted: message });
    } catch (error) {
        await sock.sendMessage(chatId, { text: `❌ Error: ${error.message}` }, { quoted: message });
    }
}

module.exports = delBotCommand;