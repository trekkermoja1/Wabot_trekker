const isOwnerOrSudo = require('../lib/isOwner');
const fs = require('fs');
const path = require('path');

const channelInfo = {
    contextInfo: {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: '120363421057570812@newsletter',
            newsletterName: 'TREKKER WABOT MD',
            serverMessageId: -1
        }
    }
};

function getAutoStatusData() {
    try {
        const dataPath = path.join(__dirname, '../data/autoStatus.json');
        if (fs.existsSync(dataPath)) {
            return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        }
    } catch (e) {}
    return { enabled: false };
}

function saveAutoStatusData(data) {
    const dataPath = path.join(__dirname, '../data/autoStatus.json');
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
}

async function autoStatusCommand(sock, chatId, msg, args) {
    try {
        if (!msg || !msg.key) {
            return;
        }

        const senderId = msg.key.participant || msg.key.remoteJid;
        const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
        
        if (!msg.key.fromMe && !isOwner) {
            await sock.sendMessage(chatId, { 
                text: '❌ This command can only be used by the owner!',
                ...channelInfo
            });
            return;
        }

        const data = getAutoStatusData();
        const action = args ? args[0]?.toLowerCase() : null;

        if (action === 'on') {
            data.enabled = true;
            saveAutoStatusData(data);
            await sock.sendMessage(chatId, { 
                text: '✅ Auto status viewing has been enabled!',
                ...channelInfo
            });
        } else if (action === 'off') {
            data.enabled = false;
            saveAutoStatusData(data);
            await sock.sendMessage(chatId, { 
                text: '❌ Auto status viewing has been disabled.',
                ...channelInfo
            });
        } else {
            const status = data.enabled ? 'enabled' : 'disabled';
            await sock.sendMessage(chatId, { 
                text: `Auto status is currently ${status}\n\nUse .autostatus on to enable\nUse .autostatus off to disable`,
                ...channelInfo
            });
        }

    } catch (error) {
        console.error('Error in autostatus command:', error);
    }
}

async function handleStatusUpdate(sock, status) {
    try {
        const data = getAutoStatusData();
        if (!data.enabled) {
            return;
        }

        // Log when status is viewed
        console.log('=== STATUS VIEWED ===');
        console.log('Status update:', JSON.stringify(status, null, 2));
        console.log('=====================');
    } catch (error) {
        console.error('Error in handleStatusUpdate:', error);
    }
}

async function reactToStatus(sock, statusKey) {
    return;
}

module.exports = {
    autoStatusCommand,
    handleStatusUpdate,
    reactToStatus
};
