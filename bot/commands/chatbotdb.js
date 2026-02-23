const axios = require('axios');
const { getContext, updateContext, clearContext, clearConversation } = require('../lib/chatDb');

const USER_GROUP_DATA = require('../data/userGroupData.json');

function loadUserGroupData() {
    try {
        return USER_GROUP_DATA;
    } catch (error) {
        console.error('Error loading user group data:', error.message);
        return { groups: [], chatbot: {} };
    }
}

function getRandomDelay() {
    return Math.floor(Math.random() * 3000) + 2000;
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

*Note:* Configure from dashboard`,
            quoted: message
        });
    }

    const data = loadUserGroupData();

    if (match === 'status') {
        await showTyping(sock, chatId);
        const isEnabled = data.chatbot[chatId] === true;
        const globalEnabled = global.chatbotEnabled === true;
        return sock.sendMessage(chatId, {
            text: `*Chatbot Status*

Chat: ${isEnabled ? '✅ Enabled' : '❌ Disabled'}
Global: ${globalEnabled ? '✅ Enabled' : '❌ Disabled'}
API: ${global.chatbotApiKey ? '✅ Configured' : '❌ Not Set'}
Base URL: ${global.chatbotBaseUrl ? '✅ Set' : '❌ Not Set'}`,
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

    if (match === 'on') {
        await showTyping(sock, chatId);
        if (data.chatbot[chatId]) {
            return sock.sendMessage(chatId, { 
                text: '*Chatbot is already enabled*',
                quoted: message
            });
        }
        data.chatbot[chatId] = true;

        if (instanceId) {
            await callBackend('put', `/api/instances/${instanceId}/chatbot`, {
                chatbot_enabled: true
            });
        }

        console.log(`Chatbot enabled for ${chatId}`);
        return sock.sendMessage(chatId, { 
            text: '*Chatbot has been enabled*',
            quoted: message
        });
    }

    if (match === 'off') {
        await showTyping(sock, chatId);
        if (!data.chatbot[chatId]) {
            return sock.sendMessage(chatId, { 
                text: '*Chatbot is already disabled*',
                quoted: message
            });
        }
        delete data.chatbot[chatId];

        if (instanceId) {
            await callBackend('put', `/api/instances/${instanceId}/chatbot`, {
                chatbot_enabled: false
            });
        }

        console.log(`Chatbot disabled for ${chatId}`);
        return sock.sendMessage(chatId, { 
            text: '*Chatbot has been disabled*',
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
    console.log('[CHATBOT] =================== HANDLER CALLED ===================');
    console.log('[CHATBOT] Chat ID:', chatId);
    console.log('[CHATBOT] Sender ID:', senderId);
    console.log('[CHATBOT] User message:', userMessage);
    
    const data = loadUserGroupData();
    console.log('[CHATBOT] Bot enabled for chats:', JSON.stringify(data.chatbot));
    console.log('[CHATBOT] Global chatbotEnabled:', global.chatbotEnabled);
    
    // For testing: always process if we have API key
    const apiKey = global.chatbotApiKey || process.env.CHATBOT_API_KEY;
    const baseUrl = global.chatbotBaseUrl || process.env.CHATBOT_BASE_URL || 'https://ai.megallm.io/v1';
    
    console.log('[CHATBOT] API Key present:', !!apiKey, 'Base URL:', baseUrl);
    console.log('[CHATBOT] secDbPass loaded:', !!global.secDbPass, 'Value:', global.secDbPass ? '***' : 'null');
    
    if (!apiKey || !baseUrl) {
        console.log('[CHATBOT] Missing API config - returning');
        return;
    }
    
    console.log('[CHATBOT] Processing message...');

    try {
        const botId = sock.user.id;
        const botNumber = botId.split(':')[0];
        const botLid = sock.user.lid;
        const botJids = [
            botId,
            `${botNumber}@s.whatsapp.net`,
            `${botNumber}@whatsapp.net`,
            `${botNumber}@lid`,
            botLid,
            `${botLid.split(':')[0]}@lid`
        ];

        let isBotMentioned = false;
        let isReplyToBot = false;
        const isPrivateChat = !chatId.endsWith('@g.us');

        if (message.message?.extendedTextMessage) {
            const mentionedJid = message.message.extendedTextMessage.contextInfo?.mentionedJid || [];
            const quotedParticipant = message.message.extendedTextMessage.contextInfo?.participant;
            
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
        else if (message.message?.conversation) {
            isBotMentioned = userMessage.includes(`@${botNumber}`);
        }

        if (!isPrivateChat && !isBotMentioned && !isReplyToBot) return;

        let cleanedMessage = userMessage;
        if (isBotMentioned) {
            cleanedMessage = cleanedMessage.replace(new RegExp(`@${botNumber}`, 'g'), '').trim();
        }

        if (!cleanedMessage) return;

        await showTyping(sock, chatId);

        const currentContext = await getContext(chatId, senderId, botId);
        console.log('[CHATBOT] Current context:', currentContext ? currentContext.substring(0, 50) : 'none');

        console.log('[CHATBOT] Getting AI response...');
        const response = await getMinimaxAIResponse(cleanedMessage, currentContext, apiKey, baseUrl);

        console.log('[CHATBOT] Response received:', response ? response.substring(0, 50) : 'null');

        if (!response) {
            await sock.sendMessage(chatId, { 
                text: "Sorry, I'm having trouble processing your request right now.",
                quoted: message
            });
            return;
        }

        const newContext = currentContext 
            ? currentContext + '\nUser: ' + cleanedMessage + '\nBot: ' + response
            : 'User: ' + cleanedMessage + '\nBot: ' + response;
        
        const shortContext = newContext.length > 500 ? newContext.slice(-500) : newContext;
        await updateContext(chatId, senderId, botId, shortContext);

        console.log('[CHATBOT] Sending response to', chatId);
        await new Promise(resolve => setTimeout(resolve, getRandomDelay()));

        await sock.sendMessage(chatId, {
            text: response
        }, {
            quoted: message
        });

        console.log('[CHATBOT] Response sent!');

    } catch (error) {
        console.error('Error in chatbot response:', error.message);
    }
}

async function getMinimaxAIResponse(userMessage, currentContext, apiKey, baseUrl) {
    const model = 'openai-gpt-oss-20b';
    
    const prompt = `You are a friendly WhatsApp chatbot. Keep responses short (1-2 sentences), casual and natural. Be helpful and friendly.

Conversation context:
${currentContext || 'No previous context'}

Current message: ${userMessage}

Response:`;

    try {
        let apiUrl = baseUrl.includes('ai.megallm.io') 
            ? baseUrl.replace('/v1', '') + '/chat/completions' 
            : `${baseUrl}/v1/chat/completions`;
        console.log('[CHATBOT] Calling API:', apiUrl);
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
