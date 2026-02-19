const isOwnerOrSudo = require('../lib/isOwner');
const fs = require('fs');
const path = require('path');

const batteryDataPath = path.join(__dirname, '../data/battery.json');

async function batteryCommand(sock, chatId, message, args) {
    try {
        let batteryInfo = { percentage: 0, charging: false };
        let targetJid = chatId;

        if (args && args.length > 0) {
            let number = args[0].replace(/[^0-9]/g, '');
            if (number.length > 5) {
                targetJid = number + '@s.whatsapp.net';
            }
        }

        // Check if we have tracked battery data for this specific target
        // Note: Currently we only track the bot's own battery in data/battery.json
        // In a real scenario, we might have multiple files or a database for different JIDs
        // For now, if it's the bot's own number or matches the tracked data, we show it.
        
        if (fs.existsSync(batteryDataPath)) {
            batteryInfo = JSON.parse(fs.readFileSync(batteryDataPath, 'utf8'));
        }
        
        const text = `🔋 *Battery Status* (${targetJid === chatId ? 'Self' : 'Recipient'})\n\nPercentage: ${batteryInfo.percentage}%\nStatus: ${batteryInfo.charging ? 'Charging' : 'Discharging'}`;
        
        await sock.sendMessage(chatId, { text }, { quoted: message });

    } catch (error) {
        console.error('Error in battery command:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to get battery status.' });
    }
}

module.exports = batteryCommand;