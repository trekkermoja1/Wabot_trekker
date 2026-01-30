# 🚀 TREKKER MAX WABOT

**Multi-Instance WhatsApp Bot Platform** powered by Trekker

<div align="center">
  <img src="https://img.shields.io/badge/Platform-TREKKER%20MAX-10b981?style=for-the-badge" alt="Platform"/>
  <img src="https://img.shields.io/badge/Version-1.0.0-blue?style=for-the-badge" alt="Version"/>
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License"/>
</div>

---

## 🌟 Features

- **Multi-Instance Support** - Run multiple WhatsApp bots simultaneously
- **Web-Based Pairing** - No terminal required, pair directly from the web dashboard
- **Isolated Environments** - Each bot runs in its own container with separate event listeners
- **Real-Time Status** - Monitor all bot instances in real-time
- **Easy Management** - Start, stop, restart, and delete bot instances with one click

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    TREKKER MAX WABOT                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐   │
│  │  Frontend   │────▶│   Backend   │────▶│   MongoDB   │   │
│  │  (React)    │     │  (FastAPI)  │     │  (Database) │   │
│  │  Port 3000  │     │  Port 8001  │     │  Port 27017 │   │
│  └─────────────┘     └──────┬──────┘     └─────────────┘   │
│                             │                               │
│         ┌───────────────────┼───────────────────┐          │
│         ▼                   ▼                   ▼          │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐   │
│  │ Bot Instance│     │ Bot Instance│     │ Bot Instance│   │
│  │     #1      │     │     #2      │     │     #N      │   │
│  │  Port 4001  │     │  Port 4002  │     │  Port 400N  │   │
│  └─────────────┘     └─────────────┘     └─────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### 1. Access the Dashboard
Open your browser and navigate to the frontend URL.

### 2. Create a New Bot Instance
- Click the "New Bot" button
- Enter a name for your bot
- Enter your WhatsApp number (with country code, no + or spaces)
- Click "Create & Pair"

### 3. Link Your WhatsApp
- Open WhatsApp on your phone
- Go to Settings → Linked Devices
- Tap "Link a Device"
- Select "Link with phone number instead"
- Enter the pairing code shown on screen

### 4. Manage Your Bots
- Start/Stop instances
- View connection status
- Monitor multiple bots simultaneously

---

## 📁 Project Structure

```
/app/
├── backend/              # FastAPI backend
│   ├── server.py         # Main API server
│   └── requirements.txt  # Python dependencies
├── frontend/             # React frontend
│   ├── src/
│   │   ├── App.js        # Main application
│   │   └── components/   # UI components
│   └── package.json      # Node dependencies
├── bot/                  # Bot core
│   ├── instance.js       # Bot instance runner
│   ├── main.js           # Message handler
│   ├── commands/         # Bot commands (100+)
│   ├── lib/              # Helper libraries
│   └── instances/        # Instance data storage
└── README.md
```

---

## 🤖 Bot Commands

Use `.help` or `.menu` in WhatsApp to see all available commands:

- **Group Management**: tagall, kick, ban, mute, promote, demote
- **Stickers**: sticker, simage, attp, take, crop
- **Media Download**: play, video, tiktok, instagram, spotify
- **Games**: tictactoe, hangman, trivia
- **AI**: gpt, gemini, imagine
- **And 90+ more commands!**

---

## ⚙️ API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/instances` | List all instances |
| POST | `/api/instances` | Create new instance |
| GET | `/api/instances/{id}` | Get instance details |
| GET | `/api/instances/{id}/pairing-code` | Get pairing code |
| POST | `/api/instances/{id}/start` | Start instance |
| POST | `/api/instances/{id}/stop` | Stop instance |
| DELETE | `/api/instances/{id}` | Delete instance |

---


## 📝 License

MIT License - Feel free to use and modify!

---

## 🙏 Credits

- **Trekker Team** - Platform Development
- **Baileys Library** - WhatsApp Web API
- Original Knight Bot by Professor

---

<div align="center">
  <p>Made with ❤️ by <strong>Trekker</strong></p>
  <p>© 2025 TREKKER MAX WABOT</p>
</div>
