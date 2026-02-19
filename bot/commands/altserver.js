const axios = require('axios');
const settings = require('../settings');

const BACKEND_URL = settings.backendApiUrl || 'http://0.0.0.0:5000';

async function altServerCommand(sock, chatId, message, args) {
    if (args.length < 2) {
        return await sock.sendMessage(chatId, { text: 'Usage: .altserver <phone_number> <new_server_name>' }, { quoted: message });
    }
    
    const phoneNumber = args[0].replace(/[^0-9]/g, '');
    const newServer = args[1];
    
    try {
        const lookup = await axios.get(`${BACKEND_URL}/api/instances/by-phone/${phoneNumber}`);
        if (!lookup.data?.id) {
            return await sock.sendMessage(chatId, { text: `❌ Bot not found: ${phoneNumber}` }, { quoted: message });
        }
        
        await axios.patch(`${BACKEND_URL}/api/instances/${lookup.data.id}`, { server_name: newServer });
        
        await sock.sendMessage(chatId, { 
            text: `✅ *Server Updated*\n\nPhone: ${phoneNumber}\nNew Server: ${newServer}\n\nNote: The bot registry has been modified. Changes will take effect on next restart.` 
        }, { quoted: message });
    } catch (error) {
        await sock.sendMessage(chatId, { text: `❌ Error: ${error.message}` }, { quoted: message });
    }
}

module.exports = altServerCommand;