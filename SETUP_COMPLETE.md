# TREKKER MAX WABOT - Setup Complete ✓

## Project Overview
**TREKKER MAX WABOT** is a Multi-Instance WhatsApp Bot Management Platform that allows you to create and manage multiple WhatsApp bot instances through a web interface.

## Architecture
The application consists of three main components:

### 1. Backend (Python/FastAPI) - Port 8001
- **Location:** `/app/backend/`
- **Main File:** `server.py`
- **Features:**
  - RESTful API for managing bot instances
  - Create, start, stop, delete bot instances
  - Pairing code generation for WhatsApp connection
  - Instance status monitoring
- **Admin Credentials:** 
  - Username: admin
  - Password: admin123
- **Database:** Local JSON file (`instances.json`)

### 2. Frontend (React) - Port 3000
- **Location:** `/app/frontend/`
- **Features:**
  - Admin dashboard for bot management
  - Instance creation wizard
  - Real-time status monitoring
  - Pairing code display
  - Tailwind CSS styling

### 3. Bot (Node.js) - Dynamic Ports (4000+)
- **Location:** `/app/bot/`
- **Main File:** `instance.js` (for individual instances)
- **Features:**
  - WhatsApp bot using Baileys library
  - Multiple bot instances support
  - Extensive command system (.help, .sticker, .meme, etc.)
  - Group management features
  - Anti-spam protection
  - Auto-typing, auto-read features
  - Media processing

## Setup Status

### ✓ Completed Tasks
1. **Python Dependencies** - All backend packages installed
2. **Node.js Dependencies** - Bot and frontend packages installed
3. **Supervisor Configuration** - All services configured to run automatically
4. **Environment Files** - Configured with proper URLs and settings
5. **Directory Structure** - All required directories created
6. **Services Running** - Backend, frontend, and MongoDB all operational

### Services Status
```
✓ Backend API      - http://localhost:8001
✓ Frontend         - http://localhost:3000
✓ MongoDB          - mongodb://localhost:27017
```

## File Structure
```
/app/
├── backend/
│   ├── server.py            # Main FastAPI application
│   ├── requirements.txt     # Python dependencies
│   ├── instances.json       # Bot instances database
│   └── .env                 # Environment variables
├── bot/
│   ├── instance.js          # Bot instance runner
│   ├── main.js              # Bot message handler
│   ├── config.js            # API configurations
│   ├── settings.js          # Bot settings
│   ├── commands/            # Bot command implementations
│   ├── lib/                 # Helper libraries
│   ├── instances/           # Instance-specific data
│   ├── data/                # Bot data files
│   └── temp/                # Temporary files
├── frontend/
│   ├── src/                 # React source files
│   ├── public/              # Static assets
│   ├── package.json         # Node dependencies
│   └── .env                 # Environment variables
└── package.json             # Root Node dependencies (for bot)
```

## Environment Configuration

### Backend (.env)
```
MONGO_URL=mongodb://localhost:27017
```

### Frontend (.env)
```
REACT_APP_BACKEND_URL=https://basic-setup-15.preview.emergentagent.com
```

## How to Use

### 1. Access the Admin Panel
- Open your browser and navigate to the frontend URL
- Login with admin credentials (admin/admin123)

### 2. Create a Bot Instance
- Click "Create Instance" button
- Enter instance name and phone number
- Submit to create the instance

### 3. Connect to WhatsApp
- A pairing code will be generated automatically
- Open WhatsApp on your phone
- Go to Settings → Linked Devices
- Enter the pairing code to link the bot

### 4. Manage Instances
- Start/Stop instances
- Regenerate pairing codes
- Monitor connection status
- Delete instances when needed

## API Endpoints

### Health Check
```bash
GET /api/health
```

### Authentication
```bash
POST /api/login
Body: { "username": "admin", "password": "admin123" }
```

### Instance Management
```bash
POST /api/instances              # Create instance
GET /api/instances               # List all instances
GET /api/instances/{id}          # Get instance details
POST /api/instances/{id}/start   # Start instance
POST /api/instances/{id}/stop    # Stop instance
POST /api/instances/{id}/restart # Restart instance
DELETE /api/instances/{id}       # Delete instance
GET /api/instances/{id}/pairing-code    # Get pairing code
POST /api/instances/{id}/regenerate-code # Regenerate code
```

## Service Management

### Check Service Status
```bash
sudo supervisorctl status
```

### Restart Services
```bash
sudo supervisorctl restart backend
sudo supervisorctl restart frontend
sudo supervisorctl restart all
```

### View Logs
```bash
# Backend logs
tail -f /var/log/supervisor/backend.out.log
tail -f /var/log/supervisor/backend.err.log

# Frontend logs
tail -f /var/log/supervisor/frontend.out.log
tail -f /var/log/supervisor/frontend.err.log
```

## Bot Commands (Sample)
Once a bot instance is connected, users can interact with it using these commands:

- `.help` or `.menu` - Show command list
- `.sticker` or `.s` - Create sticker from image
- `.meme` - Get random meme
- `.joke` - Get random joke
- `.weather <city>` - Get weather info
- `.tagall` - Tag all group members (admin)
- `.antilink on/off` - Toggle anti-link protection (admin)
- `.mute` - Mute group (admin)
- `.promote` - Promote to admin (admin)
- `.demote` - Demote from admin (admin)
- And many more...

## Technologies Used
- **Backend:** Python 3.11, FastAPI, Uvicorn, Motor (MongoDB)
- **Frontend:** React 18, Tailwind CSS, React Scripts
- **Bot:** Node.js, Baileys (WhatsApp library), Axios, Sharp
- **Database:** MongoDB (local)
- **Process Manager:** Supervisor
- **Web Server:** Nginx (reverse proxy)

## Next Steps
1. Access the admin panel through your frontend URL
2. Create your first bot instance
3. Connect it to WhatsApp using the pairing code
4. Start managing WhatsApp groups with your bot!

## Notes
- Each bot instance runs independently with its own session
- Instances can be managed through both the API and web interface
- Bot data is stored per-instance in `/app/bot/instances/{instance_id}/`
- The platform supports unlimited bot instances (resource-dependent)
- Hot reload is enabled for both backend and frontend during development

---
**Setup completed successfully on:** January 14, 2026
**Status:** All services operational ✓
