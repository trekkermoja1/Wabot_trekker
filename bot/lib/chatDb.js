const { Pool } = require('pg');

let conversationPool = null;

function getConversationPool() {
    if (conversationPool) return conversationPool;

    const host = process.env.CHAT_DB_HOST || 'turquoise-wilhuff-tarkin.aks1.eastus2.azure.cratedb.net';
    const port = process.env.CHAT_DB_PORT || 5432;
    const database = process.env.CHAT_DB_NAME || 'crate';
    const user = process.env.CHAT_DB_USER || 'admin';
    const password = global.secDbPass || process.env.SEC_DB_PASS;

    if (!password) {
        console.log('[CHAT DB] No password configured');
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

    initTables();
    return conversationPool;
}

async function initTables() {
    try {
        const pool = getConversationPool();
        if (!pool) return;

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
        console.log('[CHAT DB] Context table ready');
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

module.exports = {
    getConversationPool,
    getContext,
    updateContext,
    saveMessage,
    getConversationHistory,
    clearConversation,
    clearContext,
    closePool
};
