// isAdmin.js
const adminCache = new Map();
const CACHE_TTL = 30000; // 30 seconds

async function isAdmin(sock, chatId, senderId) {
    const cacheKey = `${chatId}-${senderId}`;
    const now = Date.now();
    
    if (adminCache.has(cacheKey)) {
        const cached = adminCache.get(cacheKey);
        if (now - cached.timestamp < CACHE_TTL) {
            return cached.data;
        }
    }

    try {
        const metadata = await sock.groupMetadata(chatId);
        const participants = metadata.participants || [];

        // Extract bot's pure phone number
        const botId = sock.user?.id || '';
        const botLid = sock.user?.lid || '';
        const botNumber = botId.includes(':') ? botId.split(':')[0] : (botId.includes('@') ? botId.split('@')[0] : botId);
        const botIdWithoutSuffix = botId.includes('@') ? botId.split('@')[0] : botId;
        
        // Extract numeric part from bot LID
        const botLidNumeric = botLid.includes(':') ? botLid.split(':')[0] : (botLid.includes('@') ? botLid.split('@')[0] : botLid);
        const botLidWithoutSuffix = botLid.includes('@') ? botLid.split('@')[0] : botLid;

        const senderNumber = senderId.includes(':') ? senderId.split(':')[0] : (senderId.includes('@') ? senderId.split('@')[0] : senderId);
        const senderIdWithoutSuffix = senderId.includes('@') ? senderId.split('@')[0] : senderId;

        // Check if bot is admin
        const isBotAdmin = participants.some(p => {
            const pPhoneNumber = p.phoneNumber ? p.phoneNumber.split('@')[0] : '';
            const pId = p.id ? p.id.split('@')[0] : '';
            const pLid = p.lid ? p.lid.split('@')[0] : '';
            const pFullId = p.id || '';
            const pFullLid = p.lid || '';
            const pLidNumeric = pLid.includes(':') ? pLid.split(':')[0] : pLid;
            
            const botMatches = (
                botId === pFullId || 
                botId === pFullLid || 
                botLid === pFullLid || 
                botLidNumeric === pLidNumeric || 
                botLidWithoutSuffix === pLid || 
                botNumber === pPhoneNumber || 
                botNumber === pId || 
                botIdWithoutSuffix === pPhoneNumber || 
                botIdWithoutSuffix === pId || 
                (botLid && botLid.split('@')[0].split(':')[0] === pLid)
            );
            
            return botMatches && (p.admin === 'admin' || p.admin === 'superadmin');
        });

        // Check if sender is admin
        const isSenderAdmin = participants.some(p => {
            const pPhoneNumber = p.phoneNumber ? p.phoneNumber.split('@')[0] : '';
            const pId = p.id ? p.id.split('@')[0] : '';
            const pLid = p.lid ? p.lid.split('@')[0] : '';
            const pFullId = p.id || '';
            const pFullLid = p.lid || '';
            
            const senderMatches = (
                senderId === pFullId || 
                senderId === pFullLid || 
                senderNumber === pPhoneNumber || 
                senderNumber === pId || 
                senderIdWithoutSuffix === pPhoneNumber || 
                senderIdWithoutSuffix === pId || 
                (pLid && senderIdWithoutSuffix === pLid)
            );
            
            return senderMatches && (p.admin === 'admin' || p.admin === 'superadmin');
        });

        const result = { isSenderAdmin, isBotAdmin };
        adminCache.set(cacheKey, { timestamp: now, data: result });
        return result;
    } catch (err) {
        if (err.status === 429 || err.message?.includes('rate-overlimit')) {
            console.error('⚠️ Rate limit hit in isAdmin, using fallback');
        } else {
            console.error('❌ Error in isAdmin:', err);
        }
        return { isSenderAdmin: false, isBotAdmin: false };
    }
}

module.exports = isAdmin;
