const fs = require('fs');
const path = require('path');

class CommandHandler {
    constructor(sock) {
        this.sock = sock;
        this.commands = new Map();
        this.cooldowns = new Map();
        this.loadCommands();
    }

    loadCommands() {
        const commandDir = path.join(__dirname, 'commands');
        const files = fs.readdirSync(commandDir).filter(f => f.endsWith('.js'));
        
        for (const file of files) {
            try {
                const cmd = require(path.join(commandDir, file));
                if (cmd.name && cmd.execute) {
                    this.commands.set(cmd.name, cmd);
                    if (cmd.aliases) {
                        cmd.aliases.forEach(alias => this.commands.set(alias, cmd));
                    }
                }
            } catch (e) {
                console.error(`Failed to load command ${file}:`, e);
            }
        }
        console.log(`🚀 Loaded ${this.commands.size} commands`);
    }

    async handle(chatId, senderId, message, text) {
        if (!text.startsWith('.')) return;
        
        const args = text.slice(1).split(/ +/);
        const commandName = args.shift().toLowerCase();
        const command = this.commands.get(commandName);

        if (!command) return;

        // Middleware: Cooldown
        if (this.checkCooldown(senderId, commandName, command.cooldown || 3000)) {
            return;
        }

        try {
            await command.execute(this.sock, chatId, message, args);
        } catch (e) {
            console.error(`Error executing ${commandName}:`, e);
        }
    }

    checkCooldown(senderId, commandName, duration) {
        const key = `${senderId}-${commandName}`;
        const now = Date.now();
        if (this.cooldowns.has(key)) {
            const expiration = this.cooldowns.get(key);
            if (now < expiration) return true;
        }
        this.cooldowns.set(key, now + duration);
        return false;
    }
}

module.exports = CommandHandler;