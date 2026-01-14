# TREKKER MAX WABOT

## Overview

TREKKER MAX WABOT is a multi-instance WhatsApp bot platform that enables running multiple WhatsApp bots simultaneously through a web-based management interface. The platform uses a microservices architecture with isolated bot instances, each running in its own environment with separate event listeners and authentication sessions.

The system allows users to:
- Create and manage multiple WhatsApp bot instances
- Pair WhatsApp accounts via web dashboard (no terminal required)
- Monitor bot status in real-time
- Execute various commands including group management, media downloads, AI chat, and entertainment features

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Layer
- **Technology**: React 18 with Tailwind CSS
- **Purpose**: Web dashboard for bot instance management
- **Port**: 3000
- **Features**: Instance creation, status monitoring, start/stop/restart controls

### Backend API Layer
- **Technology**: Python FastAPI with Uvicorn
- **Purpose**: REST API for managing bot instances and coordinating processes
- **Port**: 8001
- **Data Storage**: Local JSON file (`instances.json`) for instance tracking
- **Key Dependencies**: httpx for async HTTP, pydantic for validation

### Bot Instance Layer
- **Technology**: Node.js with @whiskeysockets/baileys (WhatsApp Web API)
- **Purpose**: Individual WhatsApp bot processes
- **Ports**: Dynamic allocation starting from 4001 (4001, 4002, 400N for each instance)
- **Session Storage**: File-based auth state per instance (`bot/instances/{id}/session`)

### Bot Command Architecture
- Commands are modular, stored in `bot/commands/` directory
- Each command is a separate JavaScript module
- Main entry point (`bot/main.js`) handles message routing
- Command categories: Group management, AI/chat, media download, entertainment, utility

### Data Flow
1. Frontend sends requests to FastAPI backend
2. Backend spawns/manages Node.js bot processes
3. Each bot instance maintains its own WhatsApp session
4. Bot instances communicate status back to backend via HTTP API

### Key Design Decisions
- **Multi-instance isolation**: Each bot runs as a separate process to prevent cross-contamination and enable independent management
- **Web-based pairing**: Eliminates need for terminal access, generates pairing codes via API
- **File-based storage**: Uses JSON files instead of a database for simplicity (instances.json, session files)
- **Modular commands**: Each command is self-contained for easy addition/modification

## External Dependencies

### WhatsApp Integration
- **@whiskeysockets/baileys**: WhatsApp Web API client for Node.js
- **libsignal**: Signal protocol implementation for encryption

### Media Processing
- **ffmpeg/fluent-ffmpeg**: Video/audio processing and conversion
- **sharp**: Image processing (blur, resize)
- **jimp**: JavaScript image manipulation
- **node-webpmux**: WebP sticker creation

### External APIs Used
- **Giphy API**: GIF search (`settings.giphyApiKey`)
- **NewsAPI**: News headlines
- **Various scraper APIs**: Instagram, Facebook, YouTube downloads
- **AI APIs**: GPT and Gemini endpoints for chatbot functionality
- **Tenor API**: Emoji kitchen for emoji mixing

### Node.js Key Packages
- **axios/node-fetch**: HTTP requests
- **pino**: Logging
- **node-cache**: In-memory caching
- **cheerio/jsdom**: HTML parsing for web scraping
- **qrcode/qrcode-terminal**: QR code generation for pairing

### Python Backend Dependencies
- **FastAPI**: Web framework
- **motor**: Async MongoDB driver (prepared for future use)
- **httpx**: Async HTTP client
- **python-dotenv**: Environment configuration