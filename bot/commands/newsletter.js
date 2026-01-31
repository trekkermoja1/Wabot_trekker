const { isSudo } = require('../lib/index');
const isOwnerOrSudo = require('../lib/isOwner');
const fs = require('fs');
const path = require('path');

async function newsletterCommand(sock, chatId, message, args) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
        
        if (!isOwner) {
            return await sock.sendMessage(chatId, { text: '❌ Only owner can manage newsletters.' });
        }

        if (!args || args.length === 0) {
            return await sock.sendMessage(chatId, { 
                text: `📜 *Newsletter Management Commands*\n\n` +
                      `.newsletter create <name> | <desc> - Create newsletter\n` +
                      `.newsletter follow <jid> - Follow newsletter\n` +
                      `.newsletter unfollow <jid> - Unfollow newsletter\n` +
                      `.newsletter mute <jid> - Mute newsletter\n` +
                      `.newsletter unmute <jid> - Unmute newsletter\n` +
                      `.newsletter reaction <jid> <mode> - Set reaction mode (enabled/disabled)\n` +
                      `.newsletter update name <jid> <new_name>\n` +
                      `.newsletter update desc <jid> <new_desc>\n` +
                      `.newsletter metadata <jid> - Fetch metadata\n` +
                      `.newsletter admincount <jid> - Get admin count\n` +
                      `.newsletter delete <jid> - Delete newsletter\n` +
                      `.newsletter react <jid> <serverId> <emoji> - React to message\n` +
                      `.newsletter subscribe <jid> - Subscribe to updates\n` +
                      `.newsletter follow <jid> - Follow newsletter\n` +
                      `.newsletter unfollow <jid> - Unfollow newsletter\n` +
                      `.newsletter owner <jid> <userLid> - Change owner\n` +
                      `.newsletter demote <jid> <userLid> - Demote admin\n` +
                      `.newsletter fetch <jid> - Fetch messages`
            });
        }

        const action = args[0].toLowerCase();
        
        switch (action) {
            case 'create':
                const [name, desc] = args.slice(1).join(' ').split('|').map(s => s.trim());
                if (!name) return await sock.sendMessage(chatId, { text: '❌ Provide newsletter name.' });
                const newsletter = await sock.newsletterCreate(name, desc || '');
                await sock.sendMessage(chatId, { text: `✅ Created: ${newsletter.jid}` });
                break;
            case 'follow':
                if (!args[1]) return await sock.sendMessage(chatId, { text: '❌ Provide JID.' });
                await sock.newsletterFollow(args[1]);
                await sock.sendMessage(chatId, { text: '✅ Followed.' });
                break;
            case 'unfollow':
                if (!args[1]) return await sock.sendMessage(chatId, { text: '❌ Provide JID.' });
                await sock.newsletterUnfollow(args[1]);
                await sock.sendMessage(chatId, { text: '✅ Unfollowed.' });
                break;
            case 'mute':
                if (!args[1]) return await sock.sendMessage(chatId, { text: '❌ Provide JID.' });
                await sock.newsletterMute(args[1]);
                await sock.sendMessage(chatId, { text: '✅ Muted.' });
                break;
            case 'unmute':
                if (!args[1]) return await sock.sendMessage(chatId, { text: '❌ Provide JID.' });
                await sock.newsletterUnmute(args[1]);
                await sock.sendMessage(chatId, { text: '✅ Unmuted.' });
                break;
            case 'reaction':
                if (!args[1] || !args[2]) return await sock.sendMessage(chatId, { text: '❌ Use: .newsletter reaction <jid> <enabled/disabled>' });
                await sock.newsletterReactionMode(args[1], args[2].toLowerCase());
                await sock.sendMessage(chatId, { text: `✅ Reaction mode set to ${args[2]}.` });
                break;
            case 'update':
                const subAction = args[1]?.toLowerCase();
                const jid = args[2];
                const content = args.slice(3).join(' ');
                if (subAction === 'name') {
                    await sock.newsletterUpdateName(jid, content);
                    await sock.sendMessage(chatId, { text: '✅ Name updated.' });
                } else if (subAction === 'desc') {
                    await sock.newsletterUpdateDescription(jid, content);
                    await sock.sendMessage(chatId, { text: '✅ Description updated.' });
                }
                break;
            case 'metadata':
                if (!args[1]) return await sock.sendMessage(chatId, { text: '❌ Provide JID.' });
                const metadata = await sock.newsletterMetadata('direct', args[1]);
                await sock.sendMessage(chatId, { text: JSON.stringify(metadata, null, 2) });
                break;
            case 'admincount':
                if (!args[1]) return await sock.sendMessage(chatId, { text: '❌ Provide JID.' });
                const count = await sock.newsletterAdminCount(args[1]);
                await sock.sendMessage(chatId, { text: `👥 Admin Count: ${count}` });
                break;
            case 'delete':
                if (!args[1]) return await sock.sendMessage(chatId, { text: '❌ Provide JID.' });
                await sock.newsletterDelete(args[1]);
                await sock.sendMessage(chatId, { text: '✅ Deleted.' });
                break;
            case 'subscribe':
                if (!args[1]) return await sock.sendMessage(chatId, { text: '❌ Provide JID.' });
                const sub = await sock.subscribeNewsletterUpdates(args[1]);
                await sock.sendMessage(chatId, { text: `✅ Subscribed. Duration: ${sub?.duration || 'unknown'}` });
                break;
            case 'owner':
                if (!args[1] || !args[2]) return await sock.sendMessage(chatId, { text: '❌ Use: .newsletter owner <jid> <userLid>' });
                await sock.newsletterChangeOwner(args[1], args[2]);
                await sock.sendMessage(chatId, { text: '✅ Owner changed.' });
                break;
            case 'demote':
                if (!args[1] || !args[2]) return await sock.sendMessage(chatId, { text: '❌ Use: .newsletter demote <jid> <userLid>' });
                await sock.newsletterDemote(args[1], args[2]);
                await sock.sendMessage(chatId, { text: '✅ Admin demoted.' });
                break;
            case 'fetch':
                if (!args[1]) return await sock.sendMessage(chatId, { text: '❌ Provide JID.' });
                const msgs = await sock.newsletterFetchMessages(args[1], 10, 0, 0);
                await sock.sendMessage(chatId, { text: `✅ Fetched 10 messages. Check logs for content.` });
                console.log('Newsletter Messages:', msgs);
                break;
            case 'react':
                if (!args[1] || !args[2] || !args[3]) return await sock.sendMessage(chatId, { text: '❌ Use: .newsletter react <jid> <serverId> <emoji>' });
                await sock.newsletterReactMessage(args[1], args[2], args[3]);
                await sock.sendMessage(chatId, { text: '✅ Reacted.' });
                break;
            default:
                await sock.sendMessage(chatId, { text: '❌ Unknown newsletter action.' });
        }

    } catch (error) {
        console.error('Error in newsletter command:', error);
        await sock.sendMessage(chatId, { text: `❌ Error: ${error.message}` });
    }
}

module.exports = newsletterCommand;