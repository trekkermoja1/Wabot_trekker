const fs = require('fs');
const path = require('path');
const settings = require('../settings');

async function botoffCommand(sock, chatId, message, args) {
    const senderId = message.key.participant || message.key.remoteJid;
    const isGroup = chatId.endsWith('@g.us');
    
    // Only bot owner can use this
    const ownerJid = settings.ownerNumber + '@s.whatsapp.net';
    const isOwner = senderId === ownerJid || message.key.fromMe;
    
    if (!isOwner) {
        return await sock.sendMessage(chatId, { text: '❌ Only the bot owner can use this command.' }, { quoted: message });
    }

    if (!isGroup) {
        return await sock.sendMessage(chatId, { text: '❌ This command is for groups only.' }, { quoted: message });
    }

    const dataPath = path.join(__dirname, '../data/botoff.json');
    let botoffList = [];
    
    if (fs.existsSync(dataPath)) {
        try {
            botoffList = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        } catch (e) {
            botoffList = [];
        }
    }

    const isOff = botoffList.includes(chatId);
    
    if (args[0] === 'on') {
        if (!isOff) {
            botoffList.push(chatId);
            fs.writeFileSync(dataPath, JSON.stringify(botoffList, null, 2));
        }
        await sock.sendMessage(chatId, { text: '✅ Bot is now OFF in this group for everyone except owner.' }, { quoted: message });
    } else if (args[0] === 'off') {
        if (isOff) {
            botoffList = botoffList.filter(id => id !== chatId);
            fs.writeFileSync(dataPath, JSON.stringify(botoffList, null, 2));
        }
        await sock.sendMessage(chatId, { text: '✅ Bot is now ON in this group.' }, { quoted: message });
    } else {
        await sock.sendMessage(chatId, { 
            text: `Current status: *${isOff ? 'OFF' : 'ON'}*\n\nUsage:\n.botoff on - Disable bot for group\n.botoff off - Enable bot for group` 
        }, { quoted: message });
    }
}

module.exports = botoffCommand;
