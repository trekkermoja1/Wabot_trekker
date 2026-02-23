const axios = require('axios');
const { getContext, updateContext, clearContext, saveQA, getQA, listQA, deleteQA } = require('../lib/chatDb');

const USER_GROUP_DATA = require('../data/userGroupData.json');

const TREKKER_INFO = `
╔══════════════════════════════════════╗
║      🚀 WELCOME TO TREKKER WABOT 🚀     ║
╠══════════════════════════════════════╣
║                                      ║
║  ✨ Get Your Own WhatsApp Bot!      ║
║                                      ║
║  🌐 Visit: trekker.dpdns.org        ║
║                                      ║
║  💰 Free Tier Available!            ║
║     (Several months free)            ║
║                                      ║
║  📱 Contact Dev: +254704897825      ║
║                                      ║
║  🔗 Pair Bot: .pair <your_number>   ║
║                                      ║
╚══════════════════════════════════════╝

🎯 *FEATURES AVAILABLE:*
• 🤖 AI Chatbot (like me!)
• 👁️ Auto-View Status & Stories
• 🛡️ Anti-Delete (restore deleted msgs)
• 🎵 Music Downloader
• 📥 Save WhatsApp Status
• 👁️ Download View Once
• 📊 Group Management
• 🔒 And Much More!

💬 Ask me about any feature!`;

const FEATURES_INFO = {
    'autoview': '👁️ *Auto-View* - Automatically views status updates and stories without the sender knowing!',
    'antidelete': '🛡️ *Anti-Delete* - Backs up deleted messages so you can always see what was removed!',
    'chatbot': '🤖 *AI Chatbot* - I\'m an AI assistant that can answer questions and have conversations!',
    'music': '🎵 *Music Downloader* - Download any song by name! Just send the song title.',
    'status': '📥 *Status Saver* - Save WhatsApp status videos and images to your device!',
    'viewonce': '👁️ *View Once* - Download and save view-once photos and videos!',
    'download': '📥 *Downloader* - Download videos, images, and more from WhatsApp!',
    'group': '👥 *Group Management* - Full admin controls: promote, demote, ban, mute, etc!',
    'help': '📚 *Help* - Get list of all available commands with .help'
};

function loadUserGroupData() {
    try {
        return USER_GROUP_DATA;
    } catch (error) {
        console.error('Error loading user group data:', error.message);
        return { groups: [], chatbot: {}, sudo: [] };
    }
}

function getRandomDelay() {
    return Math.floor(Math.random() * 2000) + 1000;
}

async function showTyping(sock, chatId) {
    try {
        await sock.presenceSubscribe(chatId);
        await sock.sendPresenceUpdate('composing', chatId);
        await new Promise(resolve => setTimeout(resolve, getRandomDelay()));
    } catch (error) {
        console.error('Typing indicator error:', error);
    }
}

async function callBackend(method, endpoint, data) {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:5000';
    try {
        const response = await axios({
            method,
            url: `${backendUrl}${endpoint}`,
            data,
            timeout: 10000
        });
        return response.data;
    } catch (error) {
        console.error('Backend API error:', error.message);
        return null;
    }
}

function isSudo(senderId, botNumber) {
    const data = loadUserGroupData();
    const cleanSender = senderId.replace(/@.*$/, '').replace(/[:].*$/, '');
    const sudoList = data.sudo || [];
    return sudoList.some(s => {
        const cleanSudo = s.replace(/@.*$/, '').replace(/[:].*$/, '');
        return cleanSudo === cleanSender || cleanSudo === botNumber;
    });
}

function detectFeatureQuery(message) {
    const lower = message.toLowerCase();
    for (const [key, value] of Object.entries(FEATURES_INFO)) {
        if (lower.includes(key)) {
            return value;
        }
    }
    return null;
}

function createPromotionalResponse(userMessage, isSudoUser) {
    const lower = userMessage.toLowerCase();
    
    // Check for feature queries
    const featureResponse = detectFeatureQuery(userMessage);
    if (featureResponse) {
        return featureResponse + '\n\n' + TREKKER_INFO;
    }
    
    // Check for greetings
    if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
        return `Hey! 👋 I'm Trekker WABot! ${TREKKER_INFO}`;
    }
    
    // Check for "what are your features" type questions
    if (lower.includes('feature') || lower.includes('what can you do') || lower.includes('abilities')) {
        let response = '🎯 *HERE\'S WHAT I CAN DO:*\n\n';
        for (const [key, value] of Object.entries(FEATURES_INFO)) {
            response += value + '\n\n';
        }
        response += TREKKER_INFO;
        return response;
    }
    
    // Check for "who are you" type questions
    if (lower.includes('who are you') || lower.includes('what are you') || lower.includes('your name')) {
        return `I'm *Trekker WABot*, an advanced WhatsApp bot! ${TREKKER_INFO}`;
    }
    
    // For any other question, give a brief helpful answer + promotion
    return `I'd love to help! But first - did you know you can get your own Trekker WABot? ${TREKKER_INFO}`;
}

async function handleChatbotCommand(sock, chatId, message, match, instanceId) {
    const isFromMe = message.key?.fromMe === true;

    if (!match) {
        await showTyping(sock, chatId);
        return sock.sendMessage(chatId, {
            text: `*CHATBOT SETUP*

*.chatbot on*
Enable chatbot

*.chatbot off*
Disable chatbot

*.chatbot status*
Check chatbot status

*.chatbotask <question> | <answer>*
Set custom Q&A (e.g., rice price)

*.chatbotask list*
View all Q&A

*Note:* Configure AI from dashboard`,
            quoted: message
        });
    }

    const data = loadUserGroupData();

    if (match.startsWith('ask')) {
        const args = match.slice(3).trim().split('|');
        const botId = sock.user.id;
        
        // .chatbotask list - show all Q&A
        if (match === 'ask list' || match === 'ask list') {
            const qaList = await listQA(botId);
            if (qaList.length === 0) {
                return sock.sendMessage(chatId, { text: '📝 No Q&A configured yet.\n\nSet Q&A: .chatbotask what is rice? | Rice costs 100 KES', quoted: message });
            }
            let response = '📝 *Your Q&A List:*\n\n';
            qaList.forEach((qa, i) => {
                response += `${i+1}. *Q:* ${qa.question}\n   *A:* ${qa.answer}\n\n`;
            });
            return sock.sendMessage(chatId, { text: response, quoted: message });
        }
        
        // .chatbotask clear - clear all Q&A
        if (match === 'ask clear') {
            const qaList = await listQA(botId);
            for (const qa of qaList) {
                await deleteQA(botId, qa.question);
            }
            return sock.sendMessage(chatId, { text: '✅ All Q&A cleared!', quoted: message });
        }
        
        // .chatbotask delete <question> - delete specific Q&A
        if (match.startsWith('ask delete ')) {
            const questionToDelete = match.slice(11).trim();
            await deleteQA(botId, questionToDelete);
            return sock.sendMessage(chatId, { text: `✅ Q&A for "${questionToDelete}" deleted!`, quoted: message });
        }
        
        // .chatbotask <question> | <answer> - set Q&A
        if (args.length >= 2) {
            const question = args[0].trim();
            const answer = args.slice(1).join('|').trim();
            await saveQA(botId, question, answer);
            return sock.sendMessage(chatId, { 
                text: `✅ *Q&A Saved!*\n\n*Q:* ${question}\n*A:* ${answer}`,
                quoted: message 
            });
        }
        
        // Show help
        return sock.sendMessage(chatId, {
            text: `*📝 CHATBOT Q&A SETUP*

*.chatbotask what is rice? | Rice is 100 KES*
Set Q&A answer

*.chatbotask list*
View all Q&A

*.chatbotask delete <question>*
Delete specific Q&A

*.chatbotask clear*
Clear all Q&A

*Note:* When users ask matching questions, bot will auto-reply with saved answer!`,
            quoted: message
        });
    }

    if (match === 'status') {
        await showTyping(sock, chatId);
        const isEnabled = data.chatbot[chatId] === true;
        const globalEnabled = global.chatbotEnabled === true;
        
        const botId = sock.user.id;
        const qaList = await listQA(botId);
        
        return sock.sendMessage(chatId, {
            text: `*Chatbot Status*

Chat: ${isEnabled ? '✅ Enabled' : '❌ Disabled'}
Global: ${globalEnabled ? '✅ Enabled' : '❌ Disabled'}
API: ${global.chatbotApiKey ? '✅ Configured' : '❌ Not Set'}
Q&A Set: ${qaList.length} items`,
            quoted: message
        });
    }

    if (!isFromMe) {
        await showTyping(sock, chatId);
        return sock.sendMessage(chatId, {
            text: '❌ Only the bot owner can use this command.',
            quoted: message
        });
    }

    // Block chatbot from this chat
    if (match === 'block') {
        await showTyping(sock, chatId);
        
        // Add to blocked list
        if (!data.chatbotBlock) data.chatbotBlock = {};
        data.chatbotBlock[chatId] = true;
        
        const fs = require('fs');
        const path = require('path');
        const userGroupPath = path.join(__dirname, '../data/userGroupData.json');
        fs.writeFileSync(userGroupPath, JSON.stringify(data, null, 2));

        console.log(`Chatbot blocked for ${chatId}`);
        return sock.sendMessage(chatId, { 
            text: '🚫 *Chatbot Blocked*\n\nThis chat will no longer receive AI responses.',
            quoted: message
        });
    }

    // Unblock chatbot for this chat
    if (match === 'unblock') {
        await showTyping(sock, chatId);
        
        if (data.chatbotBlock && data.chatbotBlock[chatId]) {
            delete data.chatbotBlock[chatId];
            
            const fs = require('fs');
            const path = require('path');
            const userGroupPath = path.join(__dirname, '../data/userGroupData.json');
            fs.writeFileSync(userGroupPath, JSON.stringify(data, null, 2));
        }

        console.log(`Chatbot unblocked for ${chatId}`);
        return sock.sendMessage(chatId, { 
            text: '✅ *Chatbot Unblocked*\n\nThis chat will now receive AI responses.',
            quoted: message
        });
    }

    if (match === 'on') {
        await showTyping(sock, chatId);
        
        // Remove from blocked list first
        if (data.chatbotBlock && data.chatbotBlock[chatId]) {
            delete data.chatbotBlock[chatId];
        }
        
        // Enable for this chat
        data.chatbot[chatId] = true;
        const fs = require('fs');
        const path = require('path');
        const userGroupPath = path.join(__dirname, '../data/userGroupData.json');
        fs.writeFileSync(userGroupPath, JSON.stringify(data, null, 2));

        // Update DB 
        if (instanceId) {
            await callBackend('put', `/api/instances/${instanceId}/chatbot`, {
                chatbot_enabled: true
            });
        }

        console.log(`Chatbot enabled for ${chatId}`);
        
        // Restart bot to apply changes
        await callBackend('post', `/api/instances/${instanceId}/restart`, {});
        
        return sock.sendMessage(chatId, { 
            text: '✅ *Chatbot Enabled*\n\nBot restarting...',
            quoted: message
        });
    }

    if (match === 'off') {
        await showTyping(sock, chatId);
        
        // Disable for this chat
        if (data.chatbot[chatId]) {
            delete data.chatbot[chatId];
        }
        
        // Block this chat
        if (!data.chatbotBlock) data.chatbotBlock = {};
        data.chatbotBlock[chatId] = true;
        
        const fs = require('fs');
        const path = require('path');
        const userGroupPath = path.join(__dirname, '../data/userGroupData.json');
        fs.writeFileSync(userGroupPath, JSON.stringify(data, null, 2));

        // Update DB 
        if (instanceId) {
            await callBackend('put', `/api/instances/${instanceId}/chatbot`, {
                chatbot_enabled: false
            });
        }

        console.log(`Chatbot disabled for ${chatId}`);
        
        // Restart bot to apply changes
        await callBackend('post', `/api/instances/${instanceId}/restart`, {});
        
        return sock.sendMessage(chatId, { 
            text: '❌ *Chatbot Disabled*\n\nBot restarting...',
            quoted: message
        });
    }

    await showTyping(sock, chatId);
    return sock.sendMessage(chatId, { 
        text: '*Invalid command. Use .chatbot to see usage*',
        quoted: message
    });
}

async function handleChatbotResponse(sock, chatId, message, userMessage, senderId) {
    // Reload data each time to get latest state
    const data = loadUserGroupData();
    
    console.log('[CHATBOT] Chat ID:', chatId);
    console.log('[CHATBOT] Sender ID:', senderId);
    console.log('[CHATBOT] User message:', userMessage);
    
    // Skip if message is from the bot itself
    if (message.key?.fromMe === true) {
        console.log('[CHATBOT] Skipping - message from bot');
        return;
    }
    
    // Check if chatbot is enabled - prioritize chat-specific setting, then global
    const chatEnabled = data.chatbot[chatId] === true;
    const allEnabled = data.chatbot['all'] === true;
    const globalEnabled = global.chatbotEnabled === true;
    
    // Check if chat is blocked
    const isChatBlocked = data.chatbotBlock && data.chatbotBlock[chatId] === true;
    
    // Must be enabled either in chat, all chats, or globally, AND not blocked
    const isChatEnabled = (chatEnabled || allEnabled || globalEnabled) && !isChatBlocked;
    
    console.log('[CHATBOT] Enabled - Chat:', chatEnabled, 'All:', allEnabled, 'Global:', globalEnabled, 'Blocked:', isChatBlocked);
    
    if (!isChatEnabled) {
        console.log('[CHATBOT] Chatbot disabled or blocked - not responding');
        return;
    }

    const apiKey = global.chatbotApiKey || process.env.CHATBOT_API_KEY;
    const baseUrl = global.chatbotBaseUrl || process.env.CHATBOT_BASE_URL || 'https://ai.megallm.io/v1';
    
    console.log('[CHATBOT] API Key present:', !!apiKey);
    
    if (!apiKey || !baseUrl) {
        console.log('[CHATBOT] Missing API config - returning');
        return;
    }

    try {
        const botId = sock.user.id;
        const botNumber = botId.split(':')[0];
        
        // Check if sender is sudo
        const isSudoUser = isSudo(senderId, botNumber);
        
        // Check if bot itself is a sudo bot (bot number in sudo list)
        const isSudoBot = isSudo(botNumber, botNumber);
        
        // Check if user message contains "sudo" (trigger promo)
        const triggersPromo = userMessage.toLowerCase().includes('sudo');
        
        const usePromoMode = isSudoUser || isSudoBot || triggersPromo;
        
        console.log('[CHATBOT] SudoUser:', isSudoUser, 'SudoBot:', isSudoBot, 'Triggers:', triggersPromo, 'Promo:', usePromoMode);

        // Handle mentions and replies
        let isBotMentioned = false;
        let isReplyToBot = false;
        const isPrivateChat = !chatId.endsWith('@g.us');

        if (message.message?.extendedTextMessage) {
            const mentionedJid = message.message.extendedTextMessage.contextInfo?.mentionedJid || [];
            const quotedParticipant = message.message.extendedTextMessage.contextInfo?.participant;
            const botJids = [
                botId,
                `${botNumber}@s.whatsapp.net`,
                `${botNumber}@whatsapp.net`
            ];
            
            isBotMentioned = mentionedJid.some(jid => {
                const jidNumber = jid.split('@')[0].split(':')[0];
                return botJids.some(botJid => {
                    const botJidNumber = botJid.split('@')[0].split(':')[0];
                    return jidNumber === botJidNumber;
                });
            });
            
            if (quotedParticipant) {
                const cleanQuoted = quotedParticipant.replace(/[:@].*$/, '');
                isReplyToBot = botJids.some(botJid => {
                    const cleanBot = botJid.replace(/[:@].*$/, '');
                    return cleanBot === cleanQuoted;
                });
            }
        }
        
        if (!isPrivateChat && !isBotMentioned && !isReplyToBot) return;

        let cleanedMessage = userMessage;
        if (isBotMentioned) {
            cleanedMessage = cleanedMessage.replace(new RegExp(`@${botNumber}`, 'g'), '').trim();
        }

        if (!cleanedMessage) return;

        await showTyping(sock, chatId);

        const currentContext = await getContext(chatId, senderId, botId);
        console.log('[CHATBOT] Current context:', currentContext ? 'yes' : 'no');

        let response;
        
        // Check Q&A first (custom answers)
        const qaAnswer = await getQA(botId, cleanedMessage);
        
        if (qaAnswer) {
            response = qaAnswer;
            console.log('[CHATBOT] Using Q&A answer');
        } else {
            // All users get AI responses with context
            console.log('[CHATBOT] Getting AI response with context...');
            response = await getMinimaxAIResponse(cleanedMessage, currentContext, apiKey, baseUrl, usePromoMode);
            
            if (!response) {
                response = "I'm here to help! Ask me anything.";
            }
        }

        console.log('[CHATBOT] Response:', response ? response.substring(0, 50) : 'null');

        if (!response) {
            await sock.sendMessage(chatId, { 
                text: "Sorry, I'm having trouble processing your request right now.",
                quoted: message
            });
            return;
        }

        // Update context - keep more context
        const newContext = currentContext 
            ? currentContext + '\nUser: ' + cleanedMessage + '\nBot: ' + response
            : 'User: ' + cleanedMessage + '\nBot: ' + response;
        
        // Keep last 1500 chars for better memory
        const shortContext = newContext.length > 1500 ? newContext.slice(-1500) : newContext;
        await updateContext(chatId, senderId, botId, shortContext);

        console.log('[CHATBOT] Sending response...');
        await new Promise(resolve => setTimeout(resolve, getRandomDelay()));

        // Send with WhatsApp channel forwarding
        try {
            await sock.sendMessage(chatId, {
                text: response,
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363421057570812@newsletter',
                        newsletterName: 'TREKKER WABOT',
                        serverMessageId: -1
                    }
                }
            }, {
                quoted: message
            });
        } catch (error) {
            // Fallback to regular message
            await sock.sendMessage(chatId, {
                text: response
            }, {
                quoted: message
            });
        }

        console.log('[CHATBOT] Response sent!');

    } catch (error) {
        console.error('Error in chatbot response:', error.message);
    }
}

async function getMinimaxAIResponse(userMessage, currentContext, apiKey, baseUrl, usePromoMode = false) {
    const model = 'openai-gpt-oss-20b';
    
    const contextText = currentContext || 'No previous conversation';
    console.log('[CHATBOT] Context being sent:', contextText);
    
    const lowerMsg = userMessage.toLowerCase();
    
    // Check what user is asking about
    const isAskingPrice = lowerMsg.includes('price') || lowerMsg.includes('cost') || lowerMsg.includes('how much') || lowerMsg.includes('KES') || lowerMsg.includes('shilling');
    const isAskingDeploy = lowerMsg.includes('deploy') || lowerMsg.includes('get bot') || lowerMsg.includes('create bot') || lowerMsg.includes('activate') || lowerMsg.includes('setup') || lowerMsg.includes('link');
    const isAskingFeatures = lowerMsg.includes('feature') || lowerMsg.includes('what can you do') || lowerMsg.includes('abilities') || lowerMsg.includes('commands') || lowerMsg.includes('services');
    const isAskingHelp = lowerMsg.includes('help') || lowerMsg.includes('menu') || lowerMsg.includes('list');
    
    let systemPrompt = '';
    
    // When asking about features
    if (isAskingFeatures) {
        systemPrompt = `You are Trekker WABot Sales Assistant. Provide detailed, helpful information.

FEATURES CATALOG:
🤖 AI CHATBOT - Smart AI that remembers conversations, answers questions, handles customer queries
👁️ AUTO-VIEW - Auto-views WhatsApp status updates and stories
🛡️ ANTI-DELETE - Restores deleted messages automatically  
📥 STATUS SAVER - Download & save any WhatsApp status
👁️ VIEW ONCE - Save view-once photos and videos
🎵 MUSIC DOWNLOADER - Download any song by name
📊 GROUP MANAGEMENT - Full admin controls (promote, demote, ban, mute, kick)
🔒 PRIVACY - PM Blocker, auto-read, auto-reply
📢 CHANNEL TOOLS - Broadcast messages, newsletter management
💾 DATA TOOLS - Backup/restore, session management
🔧 ADMIN TOOLS - Settings, config, custom commands
➕ AND 400+ MORE FEATURES IN DEVELOPMENT!

When asked about features, list these in a helpful way and mention they can get all this at trekker.dpdns.org`;
    }
    // When asking about price/deploy
    else if (isAskingPrice || isAskingDeploy) {
        systemPrompt = `You are Trekker WABot Sales Assistant. Guide users to get their bot.

COMPLETE STEP BY STEP GUIDE:

Step 1: Visit trekker.dpdns.org

Step 2: Enter your desired bot name and phone number (with country code)

Step 3: Click the GREEN "GET PAIRING" button

Step 4: You will receive a PAIRING CODE in WhatsApp - COPY that code

Step 5: Open WhatsApp, click the 3 dots (⋮) at top right

Step 6: Click "Linked devices"

Step 7: Click "Use phone number instead"

Step 8: Enter the pairing code

IMPORTANT: The code expires in 3-4 minutes! Act quickly!

IMPORTANT: Don't mention any payment - it's FREE!

After explaining, ask: "Do you need help with any step?"

Be warm, helpful and guide step by step.`;
    }
    // Normal conversation for promo bots
    else if (usePromoMode) {
        systemPrompt = `You are Trekker WABot, a helpful WhatsApp assistant.
- Be conversational and friendly
- If conversation leads to bots/services, naturally mention trekker.dpdns.org
- Otherwise just have a normal friendly conversation`;
    }
    // Normal users
    else {
        systemPrompt = `You are a helpful WhatsApp assistant. Be friendly and conversational.`;
    }
    
    const prompt = `${systemPrompt}

CONVERSATION HISTORY:
${contextText}

User: ${userMessage}

Your response:`;

    try {
        let apiUrl = baseUrl.includes('ai.megallm.io') 
            ? baseUrl.replace('/v1', '') + '/chat/completions' 
            : `${baseUrl}/v1/chat/completions`;
        console.log('[CHATBOT] Calling API:', apiUrl);
        console.log('[CHATBOT] Full prompt:', prompt.substring(0, 200));
        const response = await axios.post(apiUrl, {
            model: model,
            messages: [
                { role: 'user', content: prompt }
            ]
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });
        
        return response.data?.choices[0]?.message?.content || null;
    } catch (error) {
        console.error('[CHATBOT] AI API error:', error.message);
        if (error.response?.data?.error) {
            console.error('[CHATBOT] API Error details:', error.response.data.error);
        }
        return null;
    }
}

module.exports = {
    handleChatbotCommand,
    handleChatbotResponse
};
