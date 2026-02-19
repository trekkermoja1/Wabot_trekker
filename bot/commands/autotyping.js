/**
 * Knight Bot - A WhatsApp Bot
 * Presence Command - Shows fake typing or recording status
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

// Context info helper
const contextInfo = {
    forwardingScore: 1,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
        newsletterJid: '120363421057570812@newsletter',
        newsletterName: 'TREKKER WABOT MD',
        serverMessageId: -1
    }
};

// Check owner permission
async function checkOwner(sock, chatId, message) {
    const senderId = message.key.participant || message.key.remoteJid;
    const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
    
    if (!message.key.fromMe && !isOwner) {
        await sock.sendMessage(chatId, {
            text: '❌ This command is only available for the owner!',
            contextInfo
        });
        return false;
    }
    return true;
}

// Get status text for a mode
function getStatusText(mode) {
    switch(mode) {
        case 'typing': return 'Typing status enabled ✍️';
        case 'recording': return 'Recording status enabled 🎤';
        case 'both': return 'Auto Switch (Both) enabled 🔄';
        case 'off': return 'Presence indicators disabled ❌';
        default: return 'Unknown mode';
    }
}

// Save config and send confirmation
async function saveAndConfirm(sock, chatId, config) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    await sock.sendMessage(chatId, {
        text: `✅ ${getStatusText(config.mode)}`,
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
}

// Main presence command (.presence)
async function presenceCommand(sock, chatId, message) {
    try {
        if (!await checkOwner(sock, chatId, message)) return;

        const args = message.message?.conversation?.trim().split(' ').slice(1) || 
                    message.message?.extendedTextMessage?.text?.trim().split(' ').slice(1) || 
                    [];
        
        const config = initConfig();
        
        if (args.length > 0) {
            const action = args[0].toLowerCase();
            // Handle numeric options: 1=typing, 2=recording, 3=both, 4=off
            if (action === '1' || action === 'typing') {
                config.mode = 'typing';
            } else if (action === '2' || action === 'recording') {
                config.mode = 'recording';
            } else if (action === '3' || action === 'both') {
                config.mode = 'both';
            } else if (action === '4' || action === 'off') {
                config.mode = 'off';
            } else {
                await sock.sendMessage(chatId, {
                    text: '❌ Invalid option! Use:\n.presence typing (or 1)\n.presence recording (or 2)\n.presence both (or 3)\n.presence off (or 4)',
                    contextInfo
                });
                return;
            }
        } else {
            // Show current status and options
            await sock.sendMessage(chatId, {
                text: `📊 *Current Presence Status:* ${getStatusText(config.mode)}\n\n*Usage:*\n.presence typing (or 1) - Show typing\n.presence recording (or 2) - Show recording\n.presence both (or 3) - Auto switch\n.presence off (or 4) - Disable`,
                contextInfo
            });
            return;
        }
        
        await saveAndConfirm(sock, chatId, config);
    } catch (error) {
        console.error('Error in presence command:', error);
    }
}

// Typing command (.typing)
async function typingCommand(sock, chatId, message) {
    try {
        if (!await checkOwner(sock, chatId, message)) return;

        const args = message.message?.conversation?.trim().split(' ').slice(1) || 
                    message.message?.extendedTextMessage?.text?.trim().split(' ').slice(1) || 
                    [];
        
        const config = initConfig();
        
        if (args.length > 0) {
            const action = args[0].toLowerCase();
            if (action === 'on') {
                config.mode = 'typing';
            } else if (action === 'off') {
                config.mode = 'off';
            } else {
                await sock.sendMessage(chatId, {
                    text: '❌ Invalid option! Use: .typing on/off',
                    contextInfo
                });
                return;
            }
        } else {
            // Toggle typing
            config.mode = config.mode === 'typing' ? 'off' : 'typing';
        }
        
        await saveAndConfirm(sock, chatId, config);
    } catch (error) {
        console.error('Error in typing command:', error);
    }
}

// Recording command (.recording)
async function recordingCommand(sock, chatId, message) {
    try {
        if (!await checkOwner(sock, chatId, message)) return;

        const args = message.message?.conversation?.trim().split(' ').slice(1) || 
                    message.message?.extendedTextMessage?.text?.trim().split(' ').slice(1) || 
                    [];
        
        const config = initConfig();
        
        if (args.length > 0) {
            const action = args[0].toLowerCase();
            if (action === 'on') {
                config.mode = 'recording';
            } else if (action === 'off') {
                config.mode = 'off';
            } else {
                await sock.sendMessage(chatId, {
                    text: '❌ Invalid option! Use: .recording on/off',
                    contextInfo
                });
                return;
            }
        } else {
            // Toggle recording
            config.mode = config.mode === 'recording' ? 'off' : 'recording';
        }
        
        await saveAndConfirm(sock, chatId, config);
    } catch (error) {
        console.error('Error in recording command:', error);
    }
}

// Autoswitch command (.autoswitch)
async function autoswitchCommand(sock, chatId, message) {
    try {
        if (!await checkOwner(sock, chatId, message)) return;

        const args = message.message?.conversation?.trim().split(' ').slice(1) || 
                    message.message?.extendedTextMessage?.text?.trim().split(' ').slice(1) || 
                    [];
        
        const config = initConfig();
        
        if (args.length > 0) {
            const action = args[0].toLowerCase();
            if (action === 'on') {
                config.mode = 'both';
            } else if (action === 'off') {
                config.mode = 'off';
            } else {
                await sock.sendMessage(chatId, {
                    text: '❌ Invalid option! Use: .autoswitch on/off',
                    contextInfo
                });
                return;
            }
        } else {
            // Toggle autoswitch (both)
            config.mode = config.mode === 'both' ? 'off' : 'both';
        }
        
        await saveAndConfirm(sock, chatId, config);
    } catch (error) {
        console.error('Error in autoswitch command:', error);
    }
}

// Legacy autotyping command (for backward compatibility)
async function autotypingCommand(sock, chatId, message) {
    try {
        if (!await checkOwner(sock, chatId, message)) return;

        const args = message.message?.conversation?.trim().split(' ').slice(1) || 
                    message.message?.extendedTextMessage?.text?.trim().split(' ').slice(1) || 
                    [];
        
        const config = initConfig();
        
        if (args.length > 0) {
            const action = args[0].toLowerCase();
            if (action === 'typing' || action === '1') {
                config.mode = 'typing';
            } else if (action === 'recording' || action === '2') {
                config.mode = 'recording';
            } else if (action === 'both' || action === '3') {
                config.mode = 'both';
            } else if (action === 'off' || action === '4') {
                config.mode = 'off';
            } else {
                await sock.sendMessage(chatId, {
                    text: '❌ Invalid option! Use:\n.autotyping typing\n.autotyping recording\n.autotyping both\n.autotyping off',
                    contextInfo
                });
                return;
            }
        } else {
            // Default cycle: off -> typing -> recording -> both -> off
            const modes = ['off', 'typing', 'recording', 'both'];
            const currentIndex = modes.indexOf(config.mode);
            config.mode = modes[(currentIndex + 1) % modes.length];
        }
        
        await saveAndConfirm(sock, chatId, config);
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
        } else if (config.mode === 'both') {
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
    presenceCommand,
    typingCommand,
    recordingCommand,
    autoswitchCommand,
    isAutotypingEnabled,
    handleAutotypingForMessage,
    handleAutotypingForCommand: handleAutotypingForMessage,
    showTypingAfterCommand: handleAutotypingForMessage
};