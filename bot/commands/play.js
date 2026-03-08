const axios = require('axios');
const yts = require('yt-search');

const BASE_URL = 'https://noobs-api.top';

// Helper for newsletter context
const channelInfo = {
    contextInfo: {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: '120363421057570812@newsletter',
            newsletterName: 'TREKKER-md',
            serverMessageId: -1
        }
    }
};

module.exports = async (sock, chatId, msg, args) => {
    const query = args.join(' ');

    if (!query) {
        return sock.sendMessage(chatId, {
            text: 'Please provide a song name or keyword.'
        }, { quoted: msg });
    }

    try {
        console.log('[PLAY] Searching YT for:', query);
        const search = await yts(query);
        const video = search.videos[0];

        if (!video) {
            return sock.sendMessage(chatId, {
                text: 'No results found for your query.'
            }, { quoted: msg });
        }

        const safeTitle = video.title.replace(/[\\/:*?"<>|]/g, '');
        const fileName = `${safeTitle}.mp3`;
        const apiURL = `${BASE_URL}/dipto/ytDl3?link=${encodeURIComponent(video.videoId)}&format=mp3`;

        const response = await axios.get(apiURL);
        const data = response.data;

        if (!data.downloadLink) {
            return sock.sendMessage(chatId, {
                text: 'Failed to retrieve the MP3 download link.'
            }, { quoted: msg });
        }

        const message = {
            image: { url: video.thumbnail },
            caption:
                `*TREKKER-WABOT SONG PLAYER*\n\n` +
                `╭───────────────◆\n` +
                `│⿻ *Title:* ${video.title}\n` +
                `│⿻ *Duration:* ${video.timestamp}\n` +
                `│⿻ *Views:* ${video.views.toLocaleString()}\n` +
                `│⿻ *Uploaded:* ${video.ago}\n` +
                `│⿻ *Channel:* ${video.author.name}\n` +
                `╰────────────────◆\n\n` +
                `🔗 ${video.url}`,
            ...channelInfo
        };

        await sock.sendMessage(chatId, message, { quoted: msg });

        await sock.sendMessage(chatId, {
            audio: { url: data.downloadLink },
            mimetype: 'audio/mpeg',
            fileName,
            caption: 'TREKKER-WABOT V2',
            ...channelInfo
        }, { quoted: msg });

    } catch (err) {
        console.error('[PLAY] Error:', err);
        await sock.sendMessage(chatId, {
            text: 'An error occurred while processing your request.'
        }, { quoted: msg });
    }
};
