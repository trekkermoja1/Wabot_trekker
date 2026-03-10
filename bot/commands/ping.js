const os = require('os');
const fs = require('fs');
const path = require('path');
const settings = require('../settings.js');

const UPTIME_FILE = path.join(__dirname, '../../.bot_uptime.json');

function getBotStartTime() {
    try {
        if (fs.existsSync(UPTIME_FILE)) {
            const data = JSON.parse(fs.readFileSync(UPTIME_FILE, 'utf8'));
            return data.startTime;
        }
    } catch (e) {
        console.error('Error reading uptime file:', e);
    }
    return null;
}

function formatTime(seconds) {
    const days = Math.floor(seconds / (24 * 60 * 60));
    seconds = seconds % (24 * 60 * 60);
    const hours = Math.floor(seconds / (60 * 60));
    seconds = seconds % (60 * 60);
    const minutes = Math.floor(seconds / 60);
    seconds = Math.floor(seconds % 60);

    let time = '';
    if (days > 0) time += `${days}d `;
    if (hours > 0) time += `${hours}h `;
    if (minutes > 0) time += `${minutes}m `;
    if (seconds > 0 || time === '') time += `${seconds}s`;

    return time.trim();
}

async function pingCommand(sock, chatId, message) {
    try {
        const start = Date.now();
        await sock.sendMessage(chatId, { text: 'Pong!' }, { quoted: message });
        const end = Date.now();
        const ping = Math.round((end - start) / 2);

        const botStartTime = getBotStartTime() || Date.now();
        const uptimeInSeconds = Math.floor((Date.now() - botStartTime) / 1000);
        const uptimeFormatted = formatTime(uptimeInSeconds);

        const createdDate = new Date(botStartTime).toLocaleDateString('en-US', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        const botInfo = `
┏━━〔 🤖 𝐓𝐑𝐄𝐊𝐊𝐄𝐑 𝐖𝐀𝐁𝐎𝐓 〕━━┓
┃ 🚀 Ping     : ${ping} ms
┃ ⏱️ Uptime   : ${uptimeFormatted}
┃ 📅 Created  : ${createdDate}
┃ 🔖 Version  : v${settings.version}
┗━━━━━━━━━━━━━━━━━━━┛`.trim();

        await sock.sendMessage(chatId, { text: botInfo},{ quoted: message });

    } catch (error) {
        console.error('Error in ping command:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to get bot status.' });
    }
}

module.exports = pingCommand;
