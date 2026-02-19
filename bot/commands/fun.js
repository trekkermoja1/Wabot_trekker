const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const funCommands = {
    '.laugh': ['😂', '🤣', '😆', '😂', '🤣', '😅', '😁'],
    '.happy': ['😊', '😄', '✨', '🥰', '🥳', '🌈', '🎈'],
    '.fuck': ['🖕', '😡', '🤬', '🖕', '👿', '🖕', '😤'],
    '.hot': ['🔥', '🥵', '🌶️', '🌡️', '🌋', '🔥', '💥'],
    '.angry': ['😠', '😡', '🤬', '😤', '👿', '💢', '🗯️'],
    '.sad': ['😢', '😭', '🥺', '💔', '💧', '😿', '☹️'],
    '.cool': ['😎', '🤙', '🕶️', '🧊', '❄️', '💎', '✨'],
    '.love': ['❤️', '💖', '💗', '💓', '💞', '💘', '💝'],
    '.mindblown': ['🤯', '🧠', '💥', '✨', '🌌', '⚡', '☄️'],
    '.party': ['🥳', '🎊', '🎉', '🎈', '🥂', '🕺', '💃'],
    '.scared': ['😨', '😱', '😰', '👻', '🧟', '🧛', '🦇'],
    '.sleepy': ['😴', '🥱', '💤', '🛌', '🌙', '🌠', '☁️'],
    '.rich': ['💰', '💵', '💸', '🤑', '💎', '🏦', '💳'],
    '.strong': ['💪', '🏋️', '🥊', '🦾', '⚡', '🔥', '🏆'],
    '.magic': ['✨', '🪄', '🎩', '🐰', '🌟', '🔮', '🌌']
};

async function handleFunCommand(sock, msg, command) {
    const emojis = funCommands[command];
    if (!emojis) return false;

    const from = msg.key.remoteJid;
    let currentText = '';

    for (let i = 0; i < emojis.length; i++) {
        await sock.sendMessage(from, { 
            text: emojis[i], 
            edit: msg.key 
        });
        if (i < emojis.length - 1) {
            await delay(800);
        }
    }
    return true;
}

module.exports = { handleFunCommand, funCommands };
