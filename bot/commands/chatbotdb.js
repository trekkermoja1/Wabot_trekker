const axios = require('axios');
const fs = require('fs');
const path = require('path');

const USER_GROUP_DATA = path.join(__dirname, '../data/userGroupData.json');

const chatMemory = {
    messages: new Map(),
    userInfo: new Map()
};

function loadUserGroupData() {
    try {
        return JSON.parse(fs.readFileSync(USER_GROUP_DATA, 'utf-8'));
    } catch (error) {
        console.error('Error loading user group data:', error.message);
        return { groups: [], chatbot: {} };
    }
}

function saveUserGroupData(data) {
    try {
        fs.writeFileSync(USER_GROUP_DATA, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving user group data:', error.message);
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

function extractUserInfo(message) {
    const info = {};
    if (message.toLowerCase().includes('my name is')) {
        info.name = message.split('my name is')[1].trim().split(' ')[0];
    }
    if (message.toLowerCase().includes('i am') && message.toLowerCase().includes('years old')) {
        info.age = message.match(/\d+/)?.[0];
    }
    if (message.toLowerCase().includes('i live in') || message.toLowerCase().includes('i am from')) {
        info.location = message.split(/(?:i live in|i am from)/i)[1].trim().split(/[.,!?]/)[0];
    }
    return info;
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
            text: `*CHATBOT SETUP*\n\n*.chatbot on*\nEnable chatbot\n\n*.chatbot off*\nDisable chatbot\n\n*.chatbot status*\nCheck chatbot status\n\n*Note:* Configure API key and base URL from dashboard first.`,
            quoted: message
        });
    }

    const data = loadUserGroupData();

    if (match === 'status') {
        await showTyping(sock, chatId);
        const isEnabled = data.chatbot[chatId] === true;
        const globalEnabled = global.chatbotEnabled === true;
        return sock.sendMessage(chatId, {
            text: `*Chatbot Status*\n\nChat: ${isEnabled ? '✅ Enabled' : '❌ Disabled'}\nGlobal: ${globalEnabled ? '✅ Enabled' : '❌ Disabled'}\nAPI: ${global.chatbotApiKey ? '✅ Configured' : '❌ Not Set'}\nBase URL: ${global.chatbotBaseUrl ? '✅ Set' : '❌ Not Set'}`,
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
        saveUserGroupData(data);

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
        saveUserGroupData(data);

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
    const data = loadUserGroupData();
    
    if (!data.chatbot[chatId]) {
        return;
    }
    
    // If file says enabled, and we have API config, use it
    const apiKey = global.chatbotApiKey || process.env.CHATBOT_API_KEY;
    const baseUrl = global.chatbotBaseUrl || process.env.CHATBOT_BASE_URL || 'https://ai.megallm.io/v1';
    
    console.log('[CHATBOT] API Key present:', !!apiKey, 'Base URL:', baseUrl);
    
    if (!apiKey || !baseUrl) {
        console.log('[CHATBOT] Missing API config');
        return;
    }

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

        if (!chatMemory.messages.has(senderId)) {
            chatMemory.messages.set(senderId, []);
            chatMemory.userInfo.set(senderId, {});
        }

        const userInfo = extractUserInfo(cleanedMessage);
        if (Object.keys(userInfo).length > 0) {
            chatMemory.userInfo.set(senderId, {
                ...chatMemory.userInfo.get(senderId),
                ...userInfo
            });
        }

        const messages = chatMemory.messages.get(senderId);
        messages.push(cleanedMessage);
        if (messages.length > 20) {
            messages.shift();
        }
        chatMemory.messages.set(senderId, messages);

        await showTyping(sock, chatId);

        console.log('[CHATBOT] Getting AI response...');
        const response = await getMinimaxAIResponse(cleanedMessage, {
            messages: chatMemory.messages.get(senderId),
            userInfo: chatMemory.userInfo.get(senderId)
        }, apiKey, baseUrl);

        console.log('[CHATBOT] Response received:', response ? response.substring(0, 50) : 'null');

        if (!response) {
            await sock.sendMessage(chatId, { 
                text: "Sorry, I'm having trouble processing your request right now.",
                quoted: message
            });
            return;
        }

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

async function getMinimaxAIResponse(userMessage, userContext, apiKey, baseUrl) {
    const model = 'openai-gpt-oss-20b';
    
    const prompt = `You are a friendly WhatsApp chatbot. Keep responses short (1-2 sentences), casual and natural. Be helpful and friendly.

Previous conversation:
${userContext.messages.join('\n')}

User information:
${JSON.stringify(userContext.userInfo)}

Current message: ${userMessage}

Response:`;

    try {
        // Use /chat/completions without /v1 prefix based on curl example
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
