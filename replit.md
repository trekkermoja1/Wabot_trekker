# TREKKER WABOT

WhatsApp Bot with Backend and Frontend.

## Project Structure
- `bot/`: WhatsApp bot logic (Node.js)
- `frontend/`: React frontend
- `backend/`: FastAPI backend

## User Preferences
- **Package Manager**: Always use `yarn` for Node.js dependencies.
- **Start Command**: `yarn start`

## Recent Changes
- Switched from `npm` to `yarn` for all operations.
- Updated `package.json` scripts.
- Removed `package-lock.json` and `node_modules`.
- (2026-01-28) Fixed `.approve` and `.renew` commands to use phone number instead of bot_id
  - New syntax: `.approve <duration> <phone_number>` (e.g., `.approve 3 254704897825`)
  - New syntax: `.renew <duration> <phone_number>` (e.g., `.renew 3 254704897825`)
- (2026-01-28) Added DEV_MODE flag in botmanagement.js to allow anyone to execute sudo commands (for development)
- (2026-01-28) Added detailed logging for sudo commands (look for `[SUDO CMD]`, `[APPROVE CMD]`, `[RENEW CMD]` in logs)
- (2026-01-28) Fixed owner detection in isOwner.js to use the bot instance's phone number from sock.user instead of static settings
- (2026-01-31) Added 30+ new commands based on Baileys README:
  - **Privacy Commands**: block, unblock, blocklist, privacy, setlastseen, setonline, setpfpprivacy, setstatusprivacy, setreadreceipts, setgroupsadd, setdefaultdisappearing
  - **Chat Operations**: archive, unarchive, mutechat, unmutechat, markread, markunread, star, unstar, disappearing, pin, unpin, deletechat, clearchat
  - **User Query Commands**: checknumber, fetchstatus, getpp, bizprofile, setmystatus, setmyname, removemypic, device, jidinfo
- (2026-01-31) Fixed `.block` command to work properly with Baileys updateBlockStatus method
- (2026-01-31) New command files: `bot/commands/privacy.js`, `bot/commands/chatops.js`, `bot/commands/userquery.js`

## Sudo Commands (Development Mode)
Currently in DEV_MODE - anyone can execute sudo commands. To disable, set `DEV_MODE = false` in `bot/commands/botmanagement.js`.

## Owner Detection
The bot now detects the owner based on:
1. The bot instance's phone number from `sock.user.id` (shown at startup like "User: 254799257758")
2. Settings `ownerNumber` as fallback
3. Sudo list from settings and database

## Project Architecture
- Frontend builds to `backend/static/`.
- Backend serves frontend and provides API for the bot.
