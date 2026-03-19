const settings = require('../settings');
const { addSudo, removeSudo, getSudoList } = require('../lib/index');
const isOwnerOrSudo = require('../lib/isOwner');

function extractMentionedJid(message) {
    const mentioned = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (mentioned.length > 0) return mentioned[0];
    const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
    const match = text.match(/\b(\d{7,15})\b/);
    if (match) return match[1] + '@s.whatsapp.net';
    return null;
}

async function sudoCommand(sock, chatId, message) {
    try {
        const senderJid = (message.key.participant || message.key.remoteJid).split('@')[0] + '@s.whatsapp.net';
        const sudoList = await getSudoList();
        const ownerJid = settings.ownerNumber + '@s.whatsapp.net';
        
        console.log('=== SUDO COMMAND METADATA ===');
        console.log(`Message ID: ${message.key.id}`);
        console.log(`Remote JID: ${chatId}`);
        console.log(`Sender JID: ${senderJid}`);
        console.log(`Owner JID: ${ownerJid}`);
        console.log(`Is from me: ${message.key.fromMe}`);
        console.log(`Message Type: ${Object.keys(message.message || {})[0]}`);
        console.log(`Sudo list: ${JSON.stringify(sudoList)}`);
        console.log('=============================');
        
        const isOwner = senderJid === ownerJid;
        const senderNumeric = senderJid.split('@')[0];
        const isSudoUser = sudoList.some(sudoId => {
            const sudoNumeric = sudoId.split('@')[0];
            return sudoNumeric === senderNumeric;
        });
        const isAuthorized = isOwner || isSudoUser || message.key.fromMe;

        const rawText = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
        const args = rawText.trim().split(' ').slice(1);
        const sub = (args[0] || '').toLowerCase();

        if (!sub || !['add', 'del', 'remove', 'list'].includes(sub)) {
            await sock.sendMessage(chatId, { text: 'Usage:\n.sudo add <@user|number>\n.sudo del <@user|number>\n.sudo list' },{quoted :message});
            return;
        }

        if (sub === 'list') {
            const list = await getSudoList();
            if (list.length === 0) {
                await sock.sendMessage(chatId, { text: 'No sudo users set.' },{quoted :message});
                return;
            }
            const text = list.map((j, i) => `${i + 1}. ${j}`).join('\n');
            await sock.sendMessage(chatId, { text: `Sudo users:\n${text}` },{quoted :message});
            return;
        }

        if (!isAuthorized) {
            await sock.sendMessage(chatId, { text: '❌ Only developers can use this command.' },{quoted :message});
            return;
        }

        const targetJid = extractMentionedJid(message);
        if (!targetJid) {
            await sock.sendMessage(chatId, { text: 'Please mention a user or provide a number.' },{quoted :message});
            return;
        }

        if (sub === 'add') {
            const ok = await addSudo(targetJid);
            await sock.sendMessage(chatId, { text: ok ? `✅ Added sudo: ${targetJid}` : '❌ Command failed' },{quoted :message});
            return;
        }

        if (sub === 'del' || sub === 'remove') {
            if (targetJid === ownerJid) {
                await sock.sendMessage(chatId, { text: 'Owner cannot be removed.' },{quoted :message});
                return;
            }
            const ok = await removeSudo(targetJid);
            await sock.sendMessage(chatId, { text: ok ? `✅ Removed sudo: ${targetJid}` : '❌ Command failed' },{quoted :message});
            return;
        }
    } catch (error) {
        console.error('Error in sudo command:', error);
        await sock.sendMessage(chatId, { text: '❌ Command failed' },{quoted :message});
    }
}

module.exports = sudoCommand;


