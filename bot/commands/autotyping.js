/**
 * Knight Bot - A WhatsApp Bot
 * Autotyping Command - Shows fake typing or recording status
 */

const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');

// Path to store the configuration
const configPath = path.join(__dirname, '..', 'data', 'autotyping.json');

// Initialize configuration file if it doesn't exist
function initConfig() {
    if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, JSON.stringify({ mode: 'off' }, null, 2));
    }
    const config = JSON.parse(fs.readFileSync(configPath));
    // Migration for old config
    if (config.enabled !== undefined) {
        config.mode = config.enabled ? 'typing' : 'off';
        delete config.enabled;
    }
    return config;
}

// Toggle autotyping/recording feature
async function autotypingCommand(sock, chatId, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
        
        if (!message.key.fromMe && !isOwner) {
            await sock.sendMessage(chatId, {
                text: '❌ This command is only available for the owner!',
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363161513685998@newsletter',
                        newsletterName: 'TREKKER WABOT MD',
                        serverMessageId: -1
                    }
                }
            });
            return;
        }

        // Get command arguments
        const args = message.message?.conversation?.trim().split(' ').slice(1) || 
                    message.message?.extendedTextMessage?.text?.trim().split(' ').slice(1) || 
                    [];
        
        // Initialize or read config
        const config = initConfig();
        
        if (args.length > 0) {
            const action = args[0].toLowerCase();
            if (action === 'typing') {
                config.mode = 'typing';
            } else if (action === 'recording') {
                config.mode = 'recording';
            } else if (action === 'bot') {
                config.mode = 'bot';
            } else if (action === 'off') {
                config.mode = 'off';
            } else {
                await sock.sendMessage(chatId, {
                    text: '❌ Invalid option! Use:\n.autotyping typing\n.autotyping recording\n.autotyping bot\n.autotyping off',
                    contextInfo: {
                        forwardingScore: 1,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: '120363161513685998@newsletter',
                            newsletterName: 'TREKKER WABOT MD',
                            serverMessageId: -1
                        }
                    }
                });
                return;
            }
        } else {
            // Default cycle: off -> typing -> recording -> bot -> off
            const modes = ['off', 'typing', 'recording', 'bot'];
            const currentIndex = modes.indexOf(config.mode);
            config.mode = modes[(currentIndex + 1) % modes.length];
        }
        
        // Save updated configuration
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        
        // Send confirmation message
        let statusText = '';
        switch(config.mode) {
            case 'typing': statusText = 'Typing status enabled ✍️'; break;
            case 'recording': statusText = 'Recording status enabled 🎤'; break;
            case 'bot': statusText = 'Auto Switch (Bot) enabled 🤖'; break;
            case 'off': statusText = 'Presence indicators disabled ❌'; break;
        }

        await sock.sendMessage(chatId, {
            text: `✅ ${statusText}`,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363161513685998@newsletter',
                    newsletterName: 'TREKKER WABOT MD',
                    serverMessageId: -1
                }
            }
        });
        
    } catch (error) {
        console.error('Error in autotyping command:', error);
    }
}

function isAutotypingEnabled() {
    const config = initConfig();
    return config.mode !== 'off';
}

async function handleAutotypingForMessage(sock, chatId) {
    const config = initConfig();
    if (config.mode === 'off') return false;

    try {
        await sock.presenceSubscribe(chatId);
        let presence = 'composing'; // default typing
        
        if (config.mode === 'recording') {
            presence = 'recording';
        } else if (config.mode === 'bot') {
            // Randomly switch between typing and recording
            presence = Math.random() > 0.5 ? 'composing' : 'recording';
        }

        await sock.sendPresenceUpdate(presence, chatId);
        await new Promise(resolve => setTimeout(resolve, 3000));
        await sock.sendPresenceUpdate('paused', chatId);
        return true;
    } catch (error) {
        return false;
    }
}

module.exports = {
    autotypingCommand,
    isAutotypingEnabled,
    handleAutotypingForMessage,
    handleAutotypingForCommand: handleAutotypingForMessage, // Alias for backward compatibility
    showTypingAfterCommand: handleAutotypingForMessage // Alias for backward compatibility
};