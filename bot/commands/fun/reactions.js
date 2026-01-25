const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function animateEmoji(sock, chatId, msg, emojis) {
    const { key } = msg;
    let currentText = '';
    
    // Initial reaction emoji set
    for (let i = 0; i < emojis.length; i++) {
        currentText = emojis.slice(i).join(' ');
        if (currentText.length === 0) break;
        
        await sock.sendMessage(chatId, { edit: key, text: currentText });
        await delay(800);
    }
}

const funCommands = {
    'happy': ['😂', '🤣', '😁', '😅', '😆', '😊'],
    'joy': ['✨', '🎊', '🎉', '🎈', '🥳', '⭐'],
    'fuck': ['🖕', '😡', '🤬', '💢', '😤', '👿'],
    'horny': ['🍑', '💦', '🤤', '😏', '🍆', '🫦'],
    'crazy': ['🤪', '🌀', '🤯', '😵‍💫', '👽', '👾'],
    'cool': ['😎', '🧊', '❄️', '🤙', '🔥', '⚡'],
    'tired': ['😴', '🥱', '💤', '🛌', '😫', '💨'],
    'laugh': ['😆', '😄', '😃', '😀', '😂', '💀'],
    'sad': ['😢', '😭', '☹️', '😞', '💔', '🥀'],
    'love': ['❤️', '💖', '💗', '💓', '💝', '💘'],
    'fire': ['🔥', '💥', '🧨', '🌋', '💣', '🚒'],
    'party': ['🥳', '💃', '🕺', '🎶', '🎵', '🎹'],
    'scared': ['😱', '😨', '😰', '👻', '👺', '👹'],
    'angry': ['😠', '😡', '🤬', '👺', '💢', '👊'],
    'strong': ['💪', '🏋️', '🥊', '🔥', '🦁', '🏆'],
    'money': ['💰', '💵', '💸', '🏦', '💎', '💳'],
    'drink': ['🍺', '🍻', '🥂', '🍷', '🍹', '🥤'],
    'food': ['🍕', '🍔', '🍟', '🌮', '🍣', '🍦'],
    'sick': ['🤢', '🤮', '🤒', '🤕', '🏥', '🚑'],
    'smart': ['🧠', '🧐', '📖', '🎓', '🧪', '💡']
};

async function handleFunCommand(sock, chatId, msg, command) {
    const emojis = funCommands[command.toLowerCase()];
    if (emojis) {
        await animateEmoji(sock, chatId, msg, emojis);
        return true;
    }
    return false;
}

module.exports = {
    handleFunCommand,
    funCommands: Object.keys(funCommands)
};