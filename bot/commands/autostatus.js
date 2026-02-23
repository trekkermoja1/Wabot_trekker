const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');

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

// Path to store auto status configuration
const configPath = path.join(__dirname, '../data/autoStatus.json');

// Initialize config file if it doesn't exist
if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({ 
        enabled: true, 
        reactOn: true 
    }));
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

        // Read current config
        let config = JSON.parse(fs.readFileSync(configPath));

        // If no arguments, show current status
        if (!args || args.length === 0) {
            const status = config.enabled ? 'enabled' : 'disabled';
            await sock.sendMessage(chatId, { 
                text: `🔄 *Auto Status Settings*\n\n📱 *Auto Status View:* ${status}\n\n*Commands:*\n.autostatus on - Enable auto status view\n.autostatus off - Disable auto status view\n\n*Alternative Commands:*\nautoview on - Enable auto status view\nautoview off - Disable auto status view`,
                ...channelInfo
            });
            return;
        }

        // Handle on/off commands
        const command = args[0].toLowerCase();
        
        if (command === 'on') {
            config.enabled = true;
            fs.writeFileSync(configPath, JSON.stringify(config));
            await sock.sendMessage(chatId, { 
                text: '✅ Auto status view has been enabled!\nBot will now automatically view all contact statuses.',
                ...channelInfo
            });
        } else if (command === 'off') {
            config.enabled = false;
            fs.writeFileSync(configPath, JSON.stringify(config));
            await sock.sendMessage(chatId, { 
                text: '❌ Auto status view has been disabled!\nBot will no longer automatically view statuses.',
                ...channelInfo
            });
        } else {
            await sock.sendMessage(chatId, { 
                text: '❌ Invalid command! Use:\n.autostatus on/off - Enable/disable auto status view',
                ...channelInfo
            });
        }

    } catch (error) {
        console.error('Error in autostatus command:', error);
        await sock.sendMessage(chatId, { 
            text: '❌ Error occurred while managing auto status!\n' + error.message,
            ...channelInfo
        });
    }
}

// Function to check if auto status is enabled
function isAutoStatusEnabled() {
    try {
        // Priority: global.db config first, then file config
        if (global.autoviewState !== undefined) {
            return global.autoviewState;
        }
        // If no global setting, default to true
        if (!fs.existsSync(configPath)) {
            return true;
        }
        const config = JSON.parse(fs.readFileSync(configPath));
        return config.enabled;
    } catch (error) {
        console.error('Error checking auto status config:', error);
        return true; // Default to enabled
    }
}

// Function to handle status updates
async function handleStatusUpdate(sock, mek) {
    const chalk = require('chalk');
    try {
        if (!isAutoStatusEnabled()) {
            return;
        }

        if (!mek || !mek.key) {
            // Silence common sync/historical status events that don't have keys
            return;
        }

        const { remoteJid, participant } = mek.key;
        if (!remoteJid) {
            return;
        }

        try {
            // Step 1: Update presence (optional, maybe skip if too frequent)
            // await sock.sendPresenceUpdate('available');

            // Step 2: Read receipt is already handled in batch in instance.js
            // await sock.readMessages([mek.key]);

            const senderNumber = (participant || remoteJid).split('@')[0];
            // console.log(chalk.green(`✅ [AUTO-STATUS] Status fully viewed from: ${senderNumber}`));
            return true;

        } catch (error) {
            // Silence decryption errors or common network issues during status viewing
            if (!error.message.includes('decrypt') && !error.message.includes('MAC')) {
                console.error('❌ View failed:', error.message);
            }
            return false;
        }

    } catch (error) {
        // Only log unexpected errors
        if (!error.message.includes('undefined')) {
            console.error('❌ Error in auto status view:', error.message);
        }
    }
}

module.exports = {
    autoStatusCommand,
    handleStatusUpdate
};