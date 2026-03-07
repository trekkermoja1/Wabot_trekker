const { Pool } = require('pg');

let conversationPool = null;

function getConversationPool() {
    if (conversationPool) return conversationPool;

    // Use CrateDB for chat storage
    conversationPool = new Pool({
        host: 'turquoise-wilhuff-tarkin.aks1.eastus2.azure.cratedb.net',
        port: 5432,
        user: 'admin',
        password: '*,!C_x*-7-B3778(5!J(3!m*',
        database: 'crate',
        ssl: { rejectUnauthorized: false },
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000
    });

    initTables();
    return conversationPool;
}

async function initTables() {
    try {
        const pool = getConversationPool();
        if (!pool) return;

        // Chat context table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS chat_context (
                chat_jid STRING,
                sender_jid STRING,
                bot_jid STRING,
                context STRING,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (chat_jid, sender_jid, bot_jid)
            )
        `);

        // Deleted messages storage (for antidelete)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS deleted_messages (
                id LONG PRIMARY KEY,
                chat_jid STRING,
                sender_jid STRING,
                message_id STRING,
                message_content STRING,
                message_type STRING,
                deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP
            )
        `);

        // VCard storage table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS vcard_contacts (
                id LONG,
                contact_jid STRING,
                contact_phone STRING,
                contact_name STRING,
                saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id)
            )
        `);
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS chatbot_qa (
                bot_jid STRING,
                question STRING,
                answer STRING,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (bot_jid, question)
            )
        `);
        
        console.log('[CHAT DB] Tables ready');
    } catch (error) {
        console.log('[CHAT DB] Table init:', error.message);
    }
}

async function getContext(chatJid, senderJid, botJid) {
    try {
        const pool = getConversationPool();
        if (!pool) return '';

        const result = await pool.query(
            `SELECT context FROM chat_context 
             WHERE chat_jid = $1 AND sender_jid = $2 AND bot_jid = $3`,
            [String(chatJid), String(senderJid), String(botJid)]
        );

        return result.rows[0]?.context || '';
    } catch (error) {
        console.log('[CHAT DB] Get context error:', error.message);
        return '';
    }
}

async function updateContext(chatJid, senderJid, botJid, newContext) {
    try {
        const pool = getConversationPool();
        if (!pool) return;

        await pool.query(
            `INSERT INTO chat_context (chat_jid, sender_jid, bot_jid, context, updated_at)
             VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
             ON CONFLICT (chat_jid, sender_jid, bot_jid) DO UPDATE SET context = $4, updated_at = CURRENT_TIMESTAMP`,
            [String(chatJid), String(senderJid), String(botJid), newContext]
        );
        console.log('[CHAT DB] Context updated');
    } catch (error) {
        console.log('[CHAT DB] Update context error:', error.message);
    }
}

async function clearContext(chatJid, senderJid, botJid) {
    try {
        const pool = getConversationPool();
        if (!pool) return;

        await pool.query(
            `DELETE FROM chat_context WHERE chat_jid = $1 AND sender_jid = $2 AND bot_jid = $3`,
            [String(chatJid), String(senderJid), String(botJid)]
        );
    } catch (error) {
        console.log('[CHAT DB] Clear context error:', error.message);
    }
}

async function saveQA(botJid, question, answer) {
    try {
        const pool = getConversationPool();
        if (!pool) return null;

        await pool.query(
            `INSERT INTO chatbot_qa (bot_jid, question, answer, created_at)
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
             ON CONFLICT (bot_jid, question) DO UPDATE SET answer = $3`,
            [String(botJid), question.toLowerCase().trim(), answer]
        );
        return true;
    } catch (error) {
        console.log('[CHAT DB] Save QA error:', error.message);
        return null;
    }
}

async function getQA(botJid, question) {
    try {
        const pool = getConversationPool();
        if (!pool) return null;

        const result = await pool.query(
            `SELECT answer FROM chatbot_qa WHERE bot_jid = $1 AND question = $2`,
            [String(botJid), question.toLowerCase().trim()]
        );

        return result.rows[0]?.answer || null;
    } catch (error) {
        console.log('[CHAT DB] Get QA error:', error.message);
        return null;
    }
}

async function listQA(botJid) {
    try {
        const pool = getConversationPool();
        if (!pool) return [];

        const result = await pool.query(
            `SELECT question, answer FROM chatbot_qa WHERE bot_jid = $1 ORDER BY created_at DESC LIMIT 20`,
            [String(botJid)]
        );

        return result.rows;
    } catch (error) {
        console.log('[CHAT DB] List QA error:', error.message);
        return [];
    }
}

async function deleteQA(botJid, question) {
    try {
        const pool = getConversationPool();
        if (!pool) return false;

        await pool.query(
            `DELETE FROM chatbot_qa WHERE bot_jid = $1 AND question = $2`,
            [String(botJid), question.toLowerCase().trim()]
        );
        return true;
    } catch (error) {
        console.log('[CHAT DB] Delete QA error:', error.message);
        return false;
    }
}

// Antidelete functions - store deleted messages in CrateDB, auto-delete after 1 hour
async function saveDeletedMessage(chatJid, senderJid, messageId, messageContent, messageType) {
    try {
        const pool = getConversationPool();
        if (!pool) return;

        const id = Date.now() + Math.floor(Math.random() * 1000);
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

        await pool.query(
            `INSERT INTO deleted_messages (id, chat_jid, sender_jid, message_id, message_content, message_type, deleted_at, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, $7)`,
            [id, String(chatJid), String(senderJid), String(messageId), String(messageContent), String(messageType), expiresAt]
        );
        
        // Clean up expired messages
        await cleanupExpiredMessages();
    } catch (error) {
        console.log('[CHAT DB] Save deleted message error:', error.message);
    }
}

async function cleanupExpiredMessages() {
    try {
        const pool = getConversationPool();
        if (!pool) return;

        await pool.query(`DELETE FROM deleted_messages WHERE expires_at < CURRENT_TIMESTAMP`);
    } catch (error) {
        console.log('[CHAT DB] Cleanup error:', error.message);
    }
}

async function getDeletedMessages(chatJid, senderJid) {
    try {
        const pool = getConversationPool();
        if (!pool) return [];

        const result = await pool.query(
            `SELECT message_content, message_type, deleted_at FROM deleted_messages 
             WHERE chat_jid = $1 AND sender_jid = $2 AND expires_at > CURRENT_TIMESTAMP
             ORDER BY deleted_at DESC LIMIT 20`,
            [String(chatJid), String(senderJid)]
        );
        return result.rows;
    } catch (error) {
        console.log('[CHAT DB] Get deleted messages error:', error.message);
        return [];
    }
}

async function saveMessage(chatJid, senderJid, botJid, role, content) {
    // No longer storing individual messages
}

async function getConversationHistory(chatJid, senderJid, botJid, limit = 20) {
    // Returns empty - using context instead
    return [];
}

async function clearConversation(chatJid, senderJid, botJid) {
    await clearContext(chatJid, senderJid, botJid);
}

function closePool() {
    if (conversationPool) {
        conversationPool.end();
        conversationPool = null;
    }
}

async function saveVCardContact(contactJid, contactName, contactPhone = null) {
    try {
        const pool = getConversationPool();
        const normalizedPhone = String(contactPhone || contactJid).replace(/\D/g, '');
        
        if (!pool) {
            console.log('[CHAT DB] No pool available');
            return null;
        }

        const exists = await checkVCardContact(contactJid);
        
        if (exists) {
            await pool.query(
                `UPDATE vcard_contacts SET contact_name = $1, contact_phone = $2, saved_at = CURRENT_TIMESTAMP WHERE contact_jid = $3`,
                [String(contactName), String(normalizedPhone), String(contactJid)]
            );
            console.log('[CHAT DB] Updated existing vCard contact');
        } else {
            const id = Date.now() + Math.floor(Math.random() * 1000);
            await pool.query(
                `INSERT INTO vcard_contacts (id, contact_jid, contact_phone, contact_name, saved_at)
                 VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
                [id, String(contactJid), String(normalizedPhone), String(contactName)]
            );
            console.log('[CHAT DB] Inserted new vCard contact');
        }
        return true;
    } catch (error) {
        console.log('[CHAT DB] Save vCard error:', error.message);
        return null;
    }
}

async function checkVCardContact(contactJidOrPhone) {
    try {
        const pool = getConversationPool();
        const normalizedPhone = String(contactJidOrPhone).replace(/\D/g, '');
        
        if (!pool) {
            console.log('[CHAT DB] No pool available');
            return false;
        }

        const result = await pool.query(
            `SELECT id FROM vcard_contacts WHERE contact_jid = $1 OR contact_phone = $2`,
            [String(contactJidOrPhone), String(normalizedPhone)]
        );
        console.log('[CHAT DB] Check result rows:', result.rows.length);
        return result.rows.length > 0;
    } catch (error) {
        console.log('[CHAT DB] Check vCard error:', error.message);
        return false;
    }
}

async function getAllVCardContacts() {
    try {
        const pool = getConversationPool();
        if (!pool) {
            console.log('[CHAT DB] No pool available');
            return [];
        }

        const result = await pool.query(
            `SELECT contact_phone, contact_name, saved_at FROM vcard_contacts ORDER BY saved_at DESC`
        );
        return result.rows;
    } catch (error) {
        console.log('[CHAT DB] Get all vCards error:', error.message);
        return [];
    }
}

async function deleteVCardContact(contactPhone) {
    try {
        const pool = getConversationPool();
        const normalizedPhone = String(contactPhone).replace(/\D/g, '');
        
        if (!pool) {
            vcardContactsMap.delete(normalizedPhone);
            return true;
        }

        await pool.query(
            `DELETE FROM vcard_contacts WHERE contact_phone = $1`,
            [String(contactPhone)]
        );
        return true;
    } catch (error) {
        console.log('[CHAT DB] Delete vCard error:', error.message);
        return false;
    }
}

module.exports = {
    getConversationPool,
    getContext,
    updateContext,
    saveMessage,
    getConversationHistory,
    clearConversation,
    clearContext,
    saveQA,
    getQA,
    listQA,
    deleteQA,
    saveDeletedMessage,
    getDeletedMessages,
    cleanupExpiredMessages,
    closePool,
    saveVCardContact,
    checkVCardContact,
    getAllVCardContacts,
    deleteVCardContact
};
