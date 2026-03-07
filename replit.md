# TREKKER WABOT

WhatsApp Bot with Backend and Frontend.

## Project Structure
- `bot/`: WhatsApp bot logic (Node.js, Baileys library)
- `frontend/`: React frontend (builds to `backend/static/`)
- `backend/`: Express.js backend (server.js)
- `public/`: Public pairing page (landing page)

## User Preferences
- **Package Manager**: Always use `yarn` for Node.js dependencies.
- **Start Command**: `yarn install && yarn start` (runs `node backend/server.js`)
- **Port**: 5000 (Replit standard, set via environment variable)

## Architecture
- The backend serves the frontend and provides the API for the bot management system.
- Frontend builds to `backend/static/`.
- Uses SQLite fallback if no `DATABASE_URL` is set; otherwise PostgreSQL.
- Bot instances run as child processes on dynamic ports (4001+).
- The pairing page is served from `public/index.html` at `/`.
- The admin dashboard is at `/dashboard` (requires `WEB=true` env var to enable).

## Environment Variables
- `PORT` / `WEB_PORT`: Set to 5000 (Replit standard)
- `SERVER_NAME`: Name of this server instance (default: server3)
- `DATABASE_URL`: PostgreSQL connection string (optional, falls back to SQLite)
- `ADMIN_USERNAME`: Admin login username (default: admin)
- `ADMIN_PASSWORD`: Admin login password (default: admin123)
- `WEB`: Set to `true` to enable the dashboard/frontend

## Security
- CORS restricted to Replit domains and localhost
- Admin credentials should be set via environment secrets
- Request body size limited to 10mb

## Recent Changes
- (Migration) Fixed PORT from 8080 to 5000 for Replit compatibility
- (Migration) Restricted CORS from wildcard to Replit/localhost origins
- (Migration) Added request body size limits (10mb)
- (2026-01-28) Fixed `.approve` and `.renew` commands to use phone number
- (2026-01-28) Added DEV_MODE flag in botmanagement.js
- (2026-01-28) Fixed owner detection in isOwner.js
- (2026-01-31) Added 30+ new commands (privacy, chat ops, user query)
- (2026-01-31) Fixed `.block` command with Baileys updateBlockStatus
- (2026-03-07) **Group auto-save improvements:**
  - Now quotes the original message when replying privately to a user
  - Saves both JID and phone number (extracted from JID) to database
  - Updated vcard_contacts table schema to include contact_jid column
  - All contact saving functions now preserve both JID and phone number
  - `.savevcf` command now uses phone number for VCF creation

## Sudo Commands (Development Mode)
Currently in DEV_MODE - anyone can execute sudo commands. To disable, set `DEV_MODE = false` in `bot/commands/botmanagement.js`.
