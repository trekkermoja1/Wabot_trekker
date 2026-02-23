const { Pool } = require('pg');

let conversationPool = null;

function getConversationPool() {
    if (conversationPool) return conversationPool;

    const host = process.env.CHAT_DB_HOST || 'turquoise-wilhuff-tarkin.aks1.eastus2.azure.cratedb.net';
    const port = process.env.CHAT_DB_PORT || 5432;
    const database = process.env.CHAT_DB_NAME || 'crate';
    const user = process.env.CHAT_DB_USER || 'admin';
    const password = global.secDbPass || process.env.SEC_DB_PASS;

    console.log('[CHAT DB] Creating pool - Host:', host, 'User:', user, 'Password set:', !!password);

    if (!password) {
        console.log('[CHAT DB] No password configured, conversation memory disabled');
        return null;
    }

    conversationPool = new Pool({
        host,
        port,
        database,
        user,
        password,
        ssl: { rejectUnauthorized: false },
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000
    });

    console.log('[CHAT DB] Pool created for', host);

    initConversationTable();

    return conversationPool;
}

async function initConversationTable() {
    try {
        const pool = getConversationPool();
        if (!pool) return;

        await pool.query(`
            CREATE TABLE IF NOT EXISTS chat_conversations (
                id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
                chat_jid VARCHAR(200) NOT NULL,
                sender_jid VARCHAR(200) NOT NULL,
                bot_jid VARCHAR(200) NOT NULL,
                role VARCHAR(20) NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_chat_conversations_chat 
            ON chat_conversations(chat_jid, sender_jid, bot_jid)
        `);

        console.log('[CHAT DB] Table initialized');
    } catch (error) {
        console.error('[CHAT DB] Table init error:', error.message);
    }
}

async function saveMessage(chatJid, senderJid, botJid, role, content) {
    try {
        const pool = getConversationPool();
        if (!pool) return;

        await pool.query(
            `INSERT INTO chat_conversations (chat_jid, sender_jid, bot_jid, role, content) VALUES ($1, $2, $3, $4, $5)`,
            [chatJid, senderJid, botJid, role, content]
        );
    } catch (error) {
        console.error('[CHAT DB] Save message error:', error.message);
    }
}

async function getConversationHistory(chatJid, senderJid, botJid, limit = 20) {
    try {
        const pool = getConversationPool();
        if (!pool) return [];

        const result = await pool.query(
            `SELECT role, content FROM chat_conversations 
             WHERE chat_jid = $1 AND sender_jid = $2 AND bot_jid = $3 
             ORDER BY created_at DESC LIMIT $4`,
            [chatJid, senderJid, botJid, limit]
        );

        return result.rows.reverse();
    } catch (error) {
        console.error('[CHAT DB] Get history error:', error.message);
        return [];
    }
}

async function clearConversation(chatJid, senderJid, botJid) {
    try {
        const pool = getConversationPool();
        if (!pool) return;

        await pool.query(
            `DELETE FROM chat_conversations WHERE chat_jid = $1 AND sender_jid = $2 AND bot_jid = $3`,
            [chatJid, senderJid, botJid]
        );
    } catch (error) {
        console.error('[CHAT DB] Clear conversation error:', error.message);
    }
}

function closePool() {
    if (conversationPool) {
        conversationPool.end();
        conversationPool = null;
    }
}

module.exports = {
    getConversationPool,
    saveMessage,
    getConversationHistory,
    clearConversation,
    closePool
};
