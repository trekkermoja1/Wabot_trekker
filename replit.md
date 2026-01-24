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

## Project Architecture
- Frontend builds to `backend/static/`.
- Backend serves frontend and provides API for the bot.
