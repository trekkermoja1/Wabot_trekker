const isOwnerOrSudo = require('../lib/isOwner');
const fs = require('fs');
const path = require('path');

const batteryDataPath = path.join(__dirname, '../data/battery.json');

async function batteryCommand(sock, chatId, message) {
    try {
        let batteryInfo = { percentage: 0, charging: false };
        if (fs.existsSync(batteryDataPath)) {
            batteryInfo = JSON.parse(fs.readFileSync(batteryDataPath, 'utf8'));
        }
        
        const text = `🔋 *Phone Battery Status*\n\nPercentage: ${batteryInfo.percentage}%\nStatus: ${batteryInfo.charging ? 'Charging' : 'Discharging'}`;
        
        await sock.sendMessage(chatId, { text }, { quoted: message });

    } catch (error) {
        console.error('Error in battery command:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to get battery status.' });
    }
}

module.exports = batteryCommand;