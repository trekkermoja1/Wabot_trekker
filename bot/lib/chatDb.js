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
    saveQA,
    getQA,
    listQA,
    deleteQA,
    closePool
};
