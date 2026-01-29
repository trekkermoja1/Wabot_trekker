// 🧹 Fix for ENOSPC / temp overflow in hosted panels
const fs = require('fs');
const path = require('path');

// Redirect temp storage away from system /tmp
const customTemp = path.join(process.cwd(), 'temp');
if (!fs.existsSync(customTemp)) fs.mkdirSync(customTemp, { recursive: true });
process.env.TMPDIR = customTemp;
process.env.TEMP = customTemp;
process.env.TMP = customTemp;

// Auto-cleaner every 3 hours
setInterval(() => {
  fs.readdir(customTemp, (err, files) => {
    if (err) return;
    for (const file of files) {
      const filePath = path.join(customTemp, file);
      fs.stat(filePath, (err, stats) => {
        if (!err && Date.now() - stats.mtimeMs > 3 * 60 * 60 * 1000) {
          fs.unlink(filePath, () => {});
        }
      });
    }
  });
  console.log('🧹 Temp folder auto-cleaned');
}, 3 * 60 * 60 * 1000);

const settings = require('./settings');
require('./config.js');
const { isBanned } = require('./lib/isBanned');
const yts = require('yt-search');
const { fetchBuffer } = require('./lib/myfunc');
const fetch = require('node-fetch');
const ytdl = require('ytdl-core');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const { isSudo } = require('./lib/index');
const isOwnerOrSudo = require('./lib/isOwner');
const { autotypingCommand, isAutotypingEnabled, handleAutotypingForMessage, handleAutotypingForCommand, showTypingAfterCommand } = require('./commands/autotyping');
const { autoreadCommand, isAutoreadEnabled, handleAutoread } = require('./commands/autoread');

// Bot management commands
const { 
    approveCommand, 
    renewCommand,
    newBotsCommand, 
    approvedBotsCommand,
    expiredBotsCommand,
    allBotsCommand,
    deleteBotCommand,
    stopBotCommand,
    startBotCommand
} = require('./commands/botmanagement');

// Command imports
const tagAllCommand = require('./commands/tagall');
const helpCommand = require('./commands/help');
const banCommand = require('./commands/ban');
const { promoteCommand } = require('./commands/promote');
const { demoteCommand } = require('./commands/demote');
const muteCommand = require('./commands/mute');
const unmuteCommand = require('./commands/unmute');
const stickerCommand = require('./commands/sticker');
const isAdmin = require('./lib/isAdmin');
const warnCommand = require('./commands/warn');
const warningsCommand = require('./commands/warnings');
const ttsCommand = require('./commands/tts');
const { tictactoeCommand, handleTicTacToeMove } = require('./commands/tictactoe');
const { incrementMessageCount, topMembers } = require('./commands/topmembers');
const ownerCommand = require('./commands/owner');
const deleteCommand = require('./commands/delete');
const { handleAntilinkCommand, handleLinkDetection } = require('./commands/antilink');
const { handleAntitagCommand, handleTagDetection } = require('./commands/antitag');
const { Antilink } = require('./lib/antilink');
const { handleMentionDetection, mentionToggleCommand, setMentionCommand } = require('./commands/mention');
const memeCommand = require('./commands/meme');
const tagCommand = require('./commands/tag');
const tagNotAdminCommand = require('./commands/tagnotadmin');
const hideTagCommand = require('./commands/hidetag');
const jokeCommand = require('./commands/joke');
const quoteCommand = require('./commands/quote');
const factCommand = require('./commands/fact');
const weatherCommand = require('./commands/weather');
const newsCommand = require('./commands/news');
const kickCommand = require('./commands/kick');
const simageCommand = require('./commands/simage');
const attpCommand = require('./commands/attp');
const { startHangman, guessLetter } = require('./commands/hangman');
const { startTrivia, answerTrivia } = require('./commands/trivia');
const { complimentCommand } = require('./commands/compliment');
const { insultCommand } = require('./commands/insult');
const { eightBallCommand } = require('./commands/eightball');
const { lyricsCommand } = require('./commands/lyrics');
const { dareCommand } = require('./commands/dare');
const { truthCommand } = require('./commands/truth');
const { clearCommand } = require('./commands/clear');
const pingCommand = require('./commands/ping');
const aliveCommand = require('./commands/alive');
const blurCommand = require('./commands/img-blur');
const { welcomeCommand, handleJoinEvent } = require('./commands/welcome');
const { goodbyeCommand, handleLeaveEvent } = require('./commands/goodbye');
const githubCommand = require('./commands/github');
const { handleAntiBadwordCommand, handleBadwordDetection } = require('./lib/antibadword');
const antibadwordCommand = require('./commands/antibadword');
const { handleChatbotCommand, handleChatbotResponse } = require('./commands/chatbot');
const takeCommand = require('./commands/take');
const { flirtCommand } = require('./commands/flirt');
const characterCommand = require('./commands/character');
const wastedCommand = require('./commands/wasted');
const shipCommand = require('./commands/ship');
const groupInfoCommand = require('./commands/groupinfo');
const resetlinkCommand = require('./commands/resetlink');
const staffCommand = require('./commands/staff');
const unbanCommand = require('./commands/unban');
const emojimixCommand = require('./commands/emojimix');
const { handlePromotionEvent } = require('./commands/promote');
const { handleDemotionEvent } = require('./commands/demote');
const viewOnceCommand = require('./commands/viewonce');
const vcfCommand = require('./commands/vcf');
const bioCommand = require('./commands/bio');
const clearSessionCommand = require('./commands/clearsession');
const { autoStatusCommand, handleStatusUpdate } = require('./commands/autostatus');
const { simpCommand } = require('./commands/simp');
const { stupidCommand } = require('./commands/stupid');
const stickerTelegramCommand = require('./commands/stickertelegram');
const textmakerCommand = require('./commands/textmaker');
const { handleAntideleteCommand, handleMessageRevocation, storeMessage } = require('./commands/antidelete');
const clearTmpCommand = require('./commands/cleartmp');
const setProfilePicture = require('./commands/setpp');
const { setGroupDescription, setGroupName, setGroupPhoto } = require('./commands/groupmanage');
const instagramCommand = require('./commands/instagram');
const facebookCommand = require('./commands/facebook');
const spotifyCommand = require('./commands/spotify');
const playCommand = require('./commands/play');
const tiktokCommand = require('./commands/tiktok');
const songCommand = require('./commands/song');
const aiCommand = require('./commands/ai');
const urlCommand = require('./commands/url');
const { handleTranslateCommand } = require('./commands/translate');
const { handleSsCommand } = require('./commands/ss');
const { addCommandReaction, handleAreactCommand } = require('./lib/reactions');
const { goodnightCommand } = require('./commands/goodnight');
const { shayariCommand } = require('./commands/shayari');
const { rosedayCommand } = require('./commands/roseday');
const imagineCommand = require('./commands/imagine');
const videoCommand = require('./commands/video');
const sudoCommand = require('./commands/sudo');
const { miscCommand, handleHeart } = require('./commands/misc');
const { animeCommand } = require('./commands/anime');
const { piesCommand, piesAlias } = require('./commands/pies');
const stickercropCommand = require('./commands/stickercrop');
const updateCommand = require('./commands/update');
const removebgCommand = require('./commands/removebg');
const { reminiCommand } = require('./commands/remini');
const { igsCommand } = require('./commands/igs');
const { anticallCommand, readState: readAnticallState } = require('./commands/anticall');
const { pmblockerCommand, readState: readPmBlockerState } = require('./commands/pmblocker');
const settingsCommand = require('./commands/settings');
const soraCommand = require('./commands/sora');
const botoffCommand = require('./commands/botoff');

// Global settings
global.packname = settings.packname;
global.author = settings.author;
global.channelLink = "https://whatsapp.com/channel/0029Vb6vpSv6WaKiG6ZIy73H";
global.ytch = "Mr Trekker Wabot";

// Add this near the top of main.js with other global configurations
const channelInfo = {
    contextInfo: {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: '120363161513685998@newsletter',
            newsletterName: 'TREKKER WABOT MD',
            serverMessageId: -1
        }
    }
};

const { handleFunCommand } = require('./commands/fun/reactions');

async function handleMessages(sock, messageUpdate, printLog, isRestricted = false) {
    let chatId;
    try {
        const { messages, type } = messageUpdate;
        // Prioritize notify events, handle append in background if needed
        if (type === 'append') {
            // Background process for appends to keep queue clear
            setImmediate(async () => {
                try {
                    for (const msg of messages) {
                        await storeMessage(msg.key.remoteJid, msg);
                    }
                } catch (e) {}
            });
            return;
        }
        if (type !== 'notify') return;

        const message = messages[0];
        if (!message) return;
        chatId = message.key.remoteJid;
        const senderId = message.key.participant || message.key.remoteJid;
        const senderNumber = senderId.split('@')[0].replace(/[^0-9]/g, '');
        const isGroup = chatId.endsWith('@g.us');

        // Check for botoff status
        let isBotOff = false;
        try {
            const botoffPath = './bot/data/botoff.json';
            if (fs.existsSync(botoffPath)) {
                const botoffList = JSON.parse(fs.readFileSync(botoffPath, 'utf8'));
                isBotOff = botoffList.includes(chatId);
            }
        } catch (e) {}

        const senderIsSudo = await isSudo(senderId);
        
        // Ensure isOwnerOrSudo is defined
        let senderIsOwnerOrSudo = false;
        try {
            senderIsOwnerOrSudo = await isOwnerOrSudo(senderId, sock, chatId);
        } catch (e) {
            console.error('Error checking isOwnerOrSudo:', e);
            // Fallback to manual check if function fails
            const ownerJid = settings.ownerNumber + '@s.whatsapp.net';
            const { getSudoList } = require('./lib/index');
            const sudoList = await getSudoList();
            senderIsOwnerOrSudo = senderId === ownerJid || sudoList.includes(senderId) || message.key.fromMe || senderNumber === settings.ownerNumber;
        }

        // If bot is OFF in this group, ignore everyone except owner
        if (isGroup && isBotOff && !senderIsOwnerOrSudo) {
            return;
        }

        const rawText = message.message?.conversation || message.message?.extendedTextMessage?.text || message.message?.imageMessage?.caption || message.message?.videoMessage?.caption || '';
        const userMessage = rawText.trim().toLowerCase();

        // Handle autoread functionality
        if (!isRestricted) await handleAutoread(sock, message);

        // Access mode check
        let isPublic = true;
        try {
            const countData = JSON.parse(fs.readFileSync('./data/messageCount.json'));
            isPublic = countData.isPublic !== false;
        } catch (e) {}

        // Restricted bot logic: Disable all features from settings
        if (isRestricted) {
            // Only allow .pair or pair
            if (userMessage.startsWith('.pair') || userMessage.startsWith('pair')) {
                const pairCommand = require('./commands/pair');
                const q = userMessage.startsWith('.pair') ? rawText.slice(5).trim() : rawText.slice(4).trim();
                await pairCommand(sock, chatId, message, q);
                return;
            }

            // Block all other commands with activation notice
            if (userMessage.startsWith('.')) {
                await sock.sendMessage(chatId, {
                    text: `❌ *ACCESS DENIED*\n\nYour bot is not activated. Please contact admin to activate your bot: *254704897825*`,
                    ...channelInfo
                }, { quoted: message });
            }
            return; // Stop processing any other features (autotyping, autoread, antilink, etc.)
        }

        // --- NORMAL PROCESSING FOR ACTIVATED BOTS ---
        
        // In private mode, only owner/sudo can run commands
        if (!isPublic && !senderIsOwnerOrSudo) {
            return;
        }

        // List of admin commands
        const adminCommands = ['.mute', '.unmute', '.ban', '.unban', '.promote', '.demote', '.kick', '.tagall', '.tagnotadmin', '.hidetag', '.antilink', '.antitag', '.setgdesc', '.setgname', '.setgpp'];
        const isAdminCommand = adminCommands.some(cmd => userMessage.startsWith(cmd));

        // List of owner commands
        const ownerCommands = ['.mode', '.autostatus', '.antidelete', '.cleartmp', '.setpp', '.clearsession', '.areact', '.autoreact', '.autotyping', '.autoread', '.pmblocker'];
        const isOwnerCommand = ownerCommands.some(cmd => userMessage.startsWith(cmd));

        // Group check for admin commands
        if (isAdminCommand && !isGroup) {
            return await sock.sendMessage(chatId, {
                text: "❌ This command can only be used in groups."
            });
        }

        // Permission check
        if (isAdminCommand || isOwnerCommand) {
            if (!senderIsOwnerOrSudo && !message.key.fromMe) {
                const { isSenderAdmin } = isGroup ? await isAdmin(sock, chatId, senderId) : { isSenderAdmin: false };
                
                if (isAdminCommand && !isSenderAdmin) {
                    return await sock.sendMessage(chatId, {
                        text: "❌ You need to be an admin to use this command."
                    });
                }
                
                if (isOwnerCommand) {
                    return await sock.sendMessage(chatId, {
                        text: "❌ Only the bot owner can use this command."
                    });
                }
            }
        }

        // --- SUDO CATEGORY COMMANDS ---
        if (userMessage.startsWith('.')) {
            const sudoCmds = ['.searchbot', '.altserver', '.delbot', '.approve', '.newbots', '.expiredbots', '.approvedbots', '.renew', '.allbots', '.deletebot', '.stopbot', '.startbot'];
            const isSudoCmd = sudoCmds.some(cmd => userMessage.startsWith(cmd));
            if (isSudoCmd) {
                const { isSudo: checkSudo } = require('./lib/index');
                const isUserSudo = await checkSudo(senderId) || settings.sudoNumber?.some(num => senderId.includes(num.toString()));
                if (!isUserSudo) {
                    return await sock.sendMessage(chatId, {
                        text: "❌ Only developers can use this command."
                    });
                }
            }
        }

        // Handle anti-link/anti-tag detection before command processing
        if (isGroup && !senderIsOwnerOrSudo) {
            const { isSenderAdmin } = await isAdmin(sock, chatId, senderId);
            
            if (!isSenderAdmin) {
                const linkFound = await handleLinkDetection(sock, chatId, message, userMessage, senderId);
                if (linkFound) return;
                
                const badwordFound = await handleBadwordDetection(sock, chatId, message, userMessage, senderId);
                if (badwordFound) return;
            }
        }

        // Mention Toggle Logic
        const state = JSON.parse(fs.readFileSync('./data/messageCount.json'));
        if (state.mentionToggle && isGroup) {
            await handleMentionDetection(sock, chatId, message);
        }

        // Anti-tag logic
        if (isGroup) {
            await handleTagDetection(sock, chatId, message, senderId);
        }

        // Tic-Tac-Toe handling
        if (userMessage.length === 1 && !isNaN(userMessage)) {
            const handled = await handleTicTacToeMove(sock, chatId, senderId, parseInt(userMessage));
            if (handled) return;
        }

        // Hangman handling
        if (userMessage.length === 1 && /^[a-z]$/.test(userMessage)) {
            const handled = await guessLetter(sock, chatId, senderId, userMessage);
            if (handled) return;
        }

        // Trivia handling
        if (userMessage.length === 1 && /^[a-d]$/.test(userMessage)) {
            const handled = await answerTrivia(sock, chatId, senderId, userMessage);
            if (handled) return;
        }

        // Add message counts and handle autotyping
        if (isGroup) {
            await incrementMessageCount(chatId, senderId);
        }

        // Handle autotyping for regular messages
        await handleAutotypingForMessage(sock, chatId);

        // LOG COMMANDS
        if (userMessage.startsWith('.')) {
            const displayId = senderId.includes('@s.whatsapp.net') ? senderId : (senderId.split('@')[0] + '@s.whatsapp.net');
            console.log(`[COMMAND] ${displayId} sent: ${userMessage}`);
            
            // React to detected command
            try {
                await sock.sendMessage(chatId, {
                    react: {
                        text: "⚔️",
                        key: message.key
                    }
                });
            } catch (e) {
                console.error('Error reacting to command:', e);
            }
        }

        // --- NEW COMMAND: .vv / .viewonce for everyone ---
        if (userMessage === '.vv' || userMessage === '.viewonce') {
            await viewOnceCommand(sock, chatId, message);
            return;
        }

        // Store message for antidelete
        await storeMessage(chatId, message);

        // Handle fun commands
        if (userMessage.startsWith('.')) {
            const cmd = userMessage.slice(1);
            const handled = await handleFunCommand(sock, chatId, message, cmd);
            if (handled) return;
        }

        // --- CONTACT SYNC & PUSHNAME CACHING ---
        if (!global.contacts) global.contacts = {};
        const pushName = message.pushName || message.message?.extendedTextMessage?.contextInfo?.pushName;
        if (pushName && senderId) {
            global.contacts[senderId] = { name: pushName, timestamp: Date.now() };
        }

        let commandExecuted = false;

        // Command processing
        switch (true) {
            case userMessage.startsWith('.botoff'):
                await botoffCommand(sock, chatId, message, userMessage.split(' ').slice(1));
                commandExecuted = true;
                break;
            case userMessage.startsWith('.searchbot'):
                const searchBotCmd = require('./commands/searchbot');
                await searchBotCmd(sock, chatId, message, userMessage.split(' ').slice(1));
                commandExecuted = true;
                break;
            case userMessage.startsWith('.altserver'):
                const altServerCmd = require('./commands/altserver');
                await altServerCmd(sock, chatId, message, userMessage.split(' ').slice(1));
                commandExecuted = true;
                break;
            case userMessage.startsWith('.delbot'):
                const delBotCmd = require('./commands/delbot');
                await delBotCmd(sock, chatId, message, userMessage.split(' ').slice(1));
                commandExecuted = true;
                break;
            case userMessage.startsWith('.pair'):
                const pairCommand = require('./commands/pair');
                const qPair = rawText.slice(5).trim();
                await pairCommand(sock, chatId, message, qPair);
                commandExecuted = true;
                break;
            case userMessage === '.vv' || userMessage === '.viewonce':
                await viewOnceCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.vcf':
                await vcfCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.bio'):
                await bioCommand(sock, chatId, message, rawText.slice(5).trim());
                commandExecuted = true;
                break;
            case userMessage === '.ping':
                await pingCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.alive':
                await aliveCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.help' || userMessage === '.menu':
                await helpCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.owner':
                await ownerCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.groupinfo' || userMessage === '.ginfo':
                await groupInfoCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.staff':
                await staffCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.tagall'):
                await tagAllCommand(sock, chatId, message, rawText.slice(8).trim());
                commandExecuted = true;
                break;
            case userMessage.startsWith('.tagnotadmin'):
                await tagNotAdminCommand(sock, chatId, message, rawText.slice(13).trim());
                commandExecuted = true;
                break;
            case userMessage.startsWith('.hidetag'):
                await hideTagCommand(sock, chatId, message, rawText.slice(9).trim());
                commandExecuted = true;
                break;
            case userMessage.startsWith('.ban'):
                await banCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.unban'):
                await unbanCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.promote'):
                await promoteCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.demote'):
                await demoteCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.mute':
                await muteCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.unmute':
                await unmuteCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.kick'):
                await kickCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.sticker') || userMessage.startsWith('.s'):
                await stickerCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.warn'):
                await warnCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.warnings':
                await warningsCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.tts'):
                await ttsCommand(sock, chatId, message, rawText.slice(5).trim());
                commandExecuted = true;
                break;
            case userMessage.startsWith('.tictactoe'):
                await tictactoeCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.topmembers' || userMessage === '.top':
                await topMembers(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.del' || userMessage === '.delete':
                await deleteCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.antilink'):
                await handleAntilinkCommand(sock, chatId, message, userMessage.split(' ')[1]);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.antitag'):
                await handleAntitagCommand(sock, chatId, message, userMessage.split(' ')[1]);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.mention'):
                await setMentionCommand(sock, chatId, message, rawText.slice(9).trim());
                commandExecuted = true;
                break;
            case userMessage === '.mentiontoggle':
                await mentionToggleCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.meme':
                await memeCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.tag'):
                await tagCommand(sock, chatId, message, rawText.slice(5).trim());
                commandExecuted = true;
                break;
            case userMessage === '.joke':
                await jokeCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.quote':
                await quoteCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.fact':
                await factCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.weather'):
                await weatherCommand(sock, chatId, message, userMessage.split(' ')[1]);
                commandExecuted = true;
                break;
            case userMessage === '.news':
                await newsCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.simage'):
                await simageCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.attp'):
                await attpCommand(sock, chatId, message, rawText.slice(6).trim());
                commandExecuted = true;
                break;
            case userMessage === '.hangman':
                await startHangman(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.trivia':
                await startTrivia(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.compliment'):
                await complimentCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.insult'):
                await insultCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.8ball'):
                await eightBallCommand(sock, chatId, message, rawText.slice(7).trim());
                commandExecuted = true;
                break;
            case userMessage.startsWith('.lyrics'):
                await lyricsCommand(sock, chatId, message, rawText.slice(8).trim());
                commandExecuted = true;
                break;
            case userMessage === '.dare':
                await dareCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.truth':
                await truthCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.clear':
                await clearCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.blur'):
                await blurCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.welcome'):
                await welcomeCommand(sock, chatId, message, userMessage.split(' ')[1]);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.goodbye'):
                await goodbyeCommand(sock, chatId, message, userMessage.split(' ')[1]);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.github'):
                await githubCommand(sock, chatId, message, userMessage.split(' ')[1]);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.antibadword'):
                await handleAntiBadwordCommand(sock, chatId, message, userMessage.split(' ')[1]);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.chatbot'):
                await handleChatbotCommand(sock, chatId, message, userMessage.split(' ')[1]);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.take'):
                await takeCommand(sock, chatId, message, rawText.slice(6).trim());
                commandExecuted = true;
                break;
            case userMessage.startsWith('.flirt'):
                await flirtCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.character'):
                await characterCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.wasted'):
                await wastedCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.ship'):
                await shipCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.resetlink':
                await resetlinkCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.emojimix'):
                await emojimixCommand(sock, chatId, message, userMessage.split(' ')[1]);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.viewonce') || userMessage === '.vv':
                await viewOnceCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.clearsession':
                await clearSessionCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.autostatus'):
                await autoStatusCommand(sock, chatId, message, userMessage.split(' ')[1]);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.simp'):
                await simpCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.stupid'):
                await stupidCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.stickertele'):
                await stickerTelegramCommand(sock, chatId, message, userMessage.split(' ')[1]);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.textmaker'):
                await textmakerCommand(sock, chatId, message, userMessage.split(' ')[1], rawText.split('|')[1]);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.antidelete'):
                await handleAntideleteCommand(sock, chatId, message, userMessage.split(' ')[1]);
                commandExecuted = true;
                break;
            case userMessage === '.cleartmp':
                await clearTmpCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.setpp'):
                await setProfilePicture(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.setgdesc'):
                await setGroupDescription(sock, chatId, message, rawText.slice(10).trim());
                commandExecuted = true;
                break;
            case userMessage.startsWith('.setgname'):
                await setGroupName(sock, chatId, message, rawText.slice(10).trim());
                commandExecuted = true;
                break;
            case userMessage.startsWith('.setgpp'):
                await setGroupPhoto(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.ig'):
                await instagramCommand(sock, chatId, message, userMessage.split(' ')[1]);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.fb'):
                await facebookCommand(sock, chatId, message, userMessage.split(' ')[1]);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.spotify'):
                await spotifyCommand(sock, chatId, message, rawText.slice(9).trim());
                commandExecuted = true;
                break;
            case userMessage.startsWith('.play'):
                await playCommand(sock, chatId, message, rawText.slice(6).trim());
                commandExecuted = true;
                break;
            case userMessage.startsWith('.tiktok'):
                await tiktokCommand(sock, chatId, message, userMessage.split(' ')[1]);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.song'):
                await songCommand(sock, chatId, message, rawText.slice(6).trim());
                commandExecuted = true;
                break;
            case userMessage.startsWith('.ai'):
                await aiCommand(sock, chatId, message, rawText.slice(4).trim());
                commandExecuted = true;
                break;
            case userMessage.startsWith('.url'):
                await urlCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.translate') || userMessage.startsWith('.tr'):
                await handleTranslateCommand(sock, chatId, message, userMessage.split(' ').slice(1));
                commandExecuted = true;
                break;
            case userMessage.startsWith('.ss'):
                await handleSsCommand(sock, chatId, message, userMessage.split(' ')[1]);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.areact') || userMessage.startsWith('.autoreact'):
                await handleAreactCommand(sock, chatId, message, userMessage.split(' ')[1]);
                commandExecuted = true;
                break;
            case userMessage === '.gn' || userMessage === '.goodnight':
                await goodnightCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.shayari':
                await shayariCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.roseday':
                await rosedayCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.imagine'):
                await imagineCommand(sock, chatId, message, rawText.slice(9).trim());
                commandExecuted = true;
                break;
            case userMessage.startsWith('.video'):
                await videoCommand(sock, chatId, message, rawText.slice(7).trim());
                commandExecuted = true;
                break;
            case userMessage.startsWith('.sudo'):
                await sudoCommand(sock, chatId, message, userMessage.split(' ')[1], userMessage.split(' ')[2]);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.heart'):
                await handleHeart(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.anime'):
                await animeCommand(sock, chatId, message, rawText.slice(7).trim());
                commandExecuted = true;
                break;
            case userMessage.startsWith('.igs'):
                await igsCommand(sock, chatId, message, userMessage.split(' ')[1]);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.anticall'):
                await anticallCommand(sock, chatId, message, userMessage.split(' ')[1]);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.pmblocker'):
                await pmblockerCommand(sock, chatId, message, userMessage.split(' ')[1]);
                commandExecuted = true;
                break;
            case userMessage === '.mode':
                {
                    const countData = JSON.parse(fs.readFileSync('./data/messageCount.json'));
                    countData.isPublic = !countData.isPublic;
                    fs.writeFileSync('./data/messageCount.json', JSON.stringify(countData, null, 2));
                    await sock.sendMessage(chatId, { text: `✅ Bot mode changed to: *${countData.isPublic ? 'Public' : 'Private'}*` });
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.autotyping'):
                await autotypingCommand(sock, chatId, message, userMessage.split(' ')[1]);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.autoread'):
                await autoreadCommand(sock, chatId, message, userMessage.split(' ')[1]);
                commandExecuted = true;
                break;
            case userMessage === '.groupjid':
                await groupJidCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.crop':
                await stickercropCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.pies'):
                {
                    const parts = rawText.trim().split(/\s+/);
                    const args = parts.slice(1);
                    await piesCommand(sock, chatId, message, args);
                    commandExecuted = true;
                }
                break;
            case userMessage === '.china':
                await piesAlias(sock, chatId, message, 'china');
                commandExecuted = true;
                break;
            case userMessage === '.indonesia':
                await piesAlias(sock, chatId, message, 'indonesia');
                commandExecuted = true;
                break;
            case userMessage === '.japan':
                await piesAlias(sock, chatId, message, 'japan');
                commandExecuted = true;
                break;
            case userMessage === '.korea':
                await piesAlias(sock, chatId, message, 'korea');
                commandExecuted = true;
                break;
            case userMessage === '.hijab':
                await piesAlias(sock, chatId, message, 'hijab');
                commandExecuted = true;
                break;
            case userMessage.startsWith('.update'):
                {
                    const parts = rawText.trim().split(/\s+/);
                    const zipArg = parts[1] && parts[1].startsWith('http') ? parts[1] : '';
                    await updateCommand(sock, chatId, message, zipArg);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.removebg') || userMessage.startsWith('.rmbg') || userMessage.startsWith('.nobg'):
                await removebgCommand.exec(sock, message, userMessage.split(' ').slice(1));
                break;
            case userMessage.startsWith('.remini') || userMessage.startsWith('.enhance') || userMessage.startsWith('.upscale'):
                await reminiCommand(sock, chatId, message, userMessage.split(' ').slice(1));
                break;
            case userMessage.startsWith('.sora'):
                await soraCommand(sock, chatId, message);
                break;
            // Sudo Bot Management Commands
            case userMessage.startsWith('.approve'):
                {
                    const args = rawText.trim().split(/\s+/).slice(1);
                    await approveCommand(sock, chatId, message, args);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.renew'):
                {
                    const args = rawText.trim().split(/\s+/).slice(1);
                    await renewCommand(sock, chatId, message, args);
                }
                commandExecuted = true;
                break;
            case userMessage === '.newbots':
                await newBotsCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.approvedbots':
                await approvedBotsCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.expiredbots':
                await expiredBotsCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.allbots':
                await allBotsCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.deletebot'):
                {
                    const args = rawText.trim().split(/\s+/).slice(1);
                    await deleteBotCommand(sock, chatId, message, args);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.stopbot'):
                {
                    const args = rawText.trim().split(/\s+/).slice(1);
                    await stopBotCommand(sock, chatId, message, args);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.startbot'):
                {
                    const args = rawText.trim().split(/\s+/).slice(1);
                    await startBotCommand(sock, chatId, message, args);
                }
                commandExecuted = true;
                break;
            default:
                if (isGroup) {
                    // Handle non-command group messages
                    if (userMessage) {  // Make sure there's a message
                        await handleChatbotResponse(sock, chatId, message, userMessage, senderId);
                    }
                    await handleTagDetection(sock, chatId, message, senderId);
                    await handleMentionDetection(sock, chatId, message);
                }
                commandExecuted = false;
                break;
        }

        // If a command was executed, show typing status after command execution
        if (commandExecuted !== false) {
            // Command was executed, now show typing status after command execution
            await showTypingAfterCommand(sock, chatId);
        }

        // Function to handle .groupjid command
        async function groupJidCommand(sock, chatId, message) {
            const groupJid = message.key.remoteJid;

            if (!groupJid.endsWith('@g.us')) {
                return await sock.sendMessage(chatId, {
                    text: "❌ This command can only be used in a group."
                });
            }

            await sock.sendMessage(chatId, {
                text: `✅ Group JID: ${groupJid}`
            }, {
                quoted: message
            });
        }

        if (userMessage.startsWith('.')) {
            // After command is processed successfully
            await addCommandReaction(sock, message);
        }
    } catch (error) {
        console.error('❌ Error in message handler:', error.message);
        // Only try to send error message if we have a valid chatId
        if (chatId) {
            try {
                await sock.sendMessage(chatId, {
                    text: '❌ Failed to process command!',
                    ...channelInfo
                });
            } catch (sendError) {
                console.error('Failed to send error notification:', sendError.message);
            }
        }
    }
}

async function handleGroupParticipantUpdate(sock, update) {
    try {
        const { id, participants, action, author } = update;

        // Check if it's a group
        if (!id.endsWith('@g.us')) return;

        // Respect bot mode: only announce promote/demote in public mode
        let isPublic = true;
        try {
            const modeData = JSON.parse(fs.readFileSync('./data/messageCount.json'));
            if (typeof modeData.isPublic === 'boolean') isPublic = modeData.isPublic;
        } catch (e) {
            // If reading fails, default to public behavior
        }

        // Handle promotion events
        if (action === 'promote') {
            if (!isPublic) return;
            await handlePromotionEvent(sock, id, participants, author);
            return;
        }

        // Handle demotion events
        if (action === 'demote') {
            if (!isPublic) return;
            await handleDemotionEvent(sock, id, participants, author);
            return;
        }

        // Handle join events
        if (action === 'add') {
            await handleJoinEvent(sock, id, participants);
        }

        // Handle leave events
        if (action === 'remove') {
            await handleLeaveEvent(sock, id, participants);
        }
    } catch (error) {
        console.error('Error in handleGroupParticipantUpdate:', error);
    }
}

// Instead, export the handlers along with handleMessages
console.log('✅ [MAIN] Bot Message Handlers initialized');
module.exports = {
    handleMessages,
    handleGroupParticipantUpdate,
    handleStatus: async (sock, update) => {
        try {
            await handleStatusUpdate(sock, update);
        } catch (error) {
            console.error('Error in handleStatus:', error);
        }
    }
};