const fs = require('fs');
const path = require('path');
const settings = require('../settings');
const { Pool } = require('pg');

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

    // Get current botoff list from global or DB
    let botoffList = global.botoffList || [];
    const isOff = botoffList.includes(chatId);
    
    const updateDB = async (newList) => {
        global.botoffList = newList;
        if (process.env.DATABASE_URL) {
            try {
                const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
                const instanceId = global.instanceId || 'default';
                await pool.query('UPDATE bot_instances SET botoff_list = $1 WHERE id = $2', [JSON.stringify(newList), instanceId]);
                await pool.end();
            } catch (e) {
                console.error('Error updating botoff_list in DB:', e);
            }
        }
        // Fallback to local file
        try {
            const dataPath = path.join(__dirname, '../data/botoff.json');
            fs.writeFileSync(dataPath, JSON.stringify(newList, null, 2));
        } catch (e) {}
    };

    if (args[0] === 'on') {
        if (!isOff) {
            botoffList.push(chatId);
            await updateDB(botoffList);
        }
        await sock.sendMessage(chatId, { text: '✅ Bot is now OFF in this group for everyone except owner.' }, { quoted: message });
    } else if (args[0] === 'off') {
        if (isOff) {
            botoffList = botoffList.filter(id => id !== chatId);
            await updateDB(botoffList);
        }
        await sock.sendMessage(chatId, { text: '✅ Bot is now ON in this group.' }, { quoted: message });
    } else {
        await sock.sendMessage(chatId, { 
            text: `Current status: *${isOff ? 'OFF' : 'ON'}*\n\nUsage:\n.botoff on - Disable bot for group\n.botoff off - Enable bot for group` 
        }, { quoted: message });
    }
}

module.exports = botoffCommand;
