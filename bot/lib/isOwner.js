const settings = require('../settings');
const { isSudo } = require('./index');

async function isOwnerOrSudo(senderId, sock = null, chatId = null) {
    console.log(`[OWNER CHECK] Checking ownership for: ${senderId}`);
    
    // Get the bot's own phone number from the connected socket
    let botPhoneNumber = '';
    if (sock && sock.user) {
        botPhoneNumber = sock.user.id?.split(':')[0]?.split('@')[0] || '';
        console.log(`[OWNER CHECK] Bot's phone number from socket: ${botPhoneNumber}`);
        console.log(`[OWNER CHECK] Bot user info: ${JSON.stringify(sock.user)}`);
    }
    
    // Also check settings.ownerNumber as fallback
    const ownerJid = settings.ownerNumber + "@s.whatsapp.net";
    const ownerNumberClean = settings.ownerNumber.split(':')[0].split('@')[0];
    
    // Extract sender's numeric parts
    const senderIdClean = senderId.split(':')[0].split('@')[0];
    const senderLidNumeric = senderId.includes('@lid') ? senderId.split('@')[0].split(':')[0] : '';
    
    console.log(`[OWNER CHECK] Sender clean ID: ${senderIdClean}`);
    console.log(`[OWNER CHECK] Owner number (settings): ${ownerNumberClean}`);
    console.log(`[OWNER CHECK] Bot phone number: ${botPhoneNumber}`);
    
    // Check if sender is the bot itself (owner of this instance)
    if (botPhoneNumber && senderIdClean === botPhoneNumber) {
        console.log(`[OWNER CHECK] Match! Sender is the bot owner (bot phone: ${botPhoneNumber})`);
        return true;
    }
    
    // Direct JID match with settings owner
    if (senderId === ownerJid) {
        console.log(`[OWNER CHECK] Match! Direct JID match with settings owner`);
        return true;
    }
    
    // Check if sender's phone number matches owner number from settings
    if (senderIdClean === ownerNumberClean) {
        console.log(`[OWNER CHECK] Match! Sender matches settings owner number`);
        return true;
    }
    
    // In groups, check if sender's LID matches bot's LID (owner uses same account as bot)
    if (sock && chatId && chatId.endsWith('@g.us') && senderId.includes('@lid')) {
        try {
            // Get bot's LID numeric
            const botLid = sock.user?.lid || '';
            const botLidNumeric = botLid.includes(':') ? botLid.split(':')[0] : (botLid.includes('@') ? botLid.split('@')[0] : botLid);
            
            console.log(`[OWNER CHECK] Bot LID: ${botLid}, numeric: ${botLidNumeric}`);
            console.log(`[OWNER CHECK] Sender LID numeric: ${senderLidNumeric}`);
            
            // Check if sender's LID numeric matches bot's LID numeric
            if (senderLidNumeric && botLidNumeric && senderLidNumeric === botLidNumeric) {
                console.log(`[OWNER CHECK] Match! Sender LID matches bot LID`);
                return true;
            }
            
            // Also check participant data for additional matching
            const metadata = await sock.groupMetadata(chatId);
            const participants = metadata.participants || [];
            
            const participant = participants.find(p => {
                const pLid = p.lid || '';
                const pLidNumeric = pLid.includes(':') ? pLid.split(':')[0] : (pLid.includes('@') ? pLid.split('@')[0] : pLid);
                const pId = p.id || '';
                const pIdClean = pId.split(':')[0].split('@')[0];
                
                return (
                    p.lid === senderId || 
                    p.id === senderId ||
                    pLidNumeric === senderLidNumeric ||
                    pIdClean === senderIdClean ||
                    pIdClean === ownerNumberClean ||
                    (botPhoneNumber && pIdClean === botPhoneNumber)
                );
            });
            
            if (participant) {
                const participantId = participant.id || '';
                const participantLid = participant.lid || '';
                const participantIdClean = participantId.split(':')[0].split('@')[0];
                const participantLidNumeric = participantLid.includes(':') ? participantLid.split(':')[0] : (participantLid.includes('@') ? participantLid.split('@')[0] : participantLid);
                
                if (participantId === ownerJid || 
                    participantIdClean === ownerNumberClean ||
                    participantLidNumeric === botLidNumeric ||
                    (botPhoneNumber && participantIdClean === botPhoneNumber)) {
                    console.log(`[OWNER CHECK] Match! Participant data matches owner`);
                    return true;
                }
            }
        } catch (e) {
            console.error('❌ [isOwner] Error checking participant data:', e);
        }
    }
    
    // Check if sender ID contains owner number (fallback)
    if (senderId.includes(ownerNumberClean)) {
        console.log(`[OWNER CHECK] Match! Sender ID contains owner number`);
        return true;
    }
    
    // Check if sender ID contains bot phone number (fallback)
    if (botPhoneNumber && senderId.includes(botPhoneNumber)) {
        console.log(`[OWNER CHECK] Match! Sender ID contains bot phone number`);
        return true;
    }
    
    // Check sudo status
    try {
        const isSudoUser = await isSudo(senderId);
        if (isSudoUser) {
            console.log(`[OWNER CHECK] Match! Sender is sudo user`);
            return true;
        }
    } catch (e) {
        console.error('❌ [isOwner] Error checking sudo:', e);
    }
    
    console.log(`[OWNER CHECK] No match found for: ${senderId}`);
    return false;
}

module.exports = isOwnerOrSudo;