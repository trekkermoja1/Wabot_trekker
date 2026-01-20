# TREKKER MAX WABOT - Commercial Deployment Guide

## Prerequisites
- Node.js (v20+)
- Python (v3.11+)
- PostgreSQL Database

## Local Setup
1. **Environment Variables**: Create a `.env` file in the root.
   ```env
   DATABASE_URL=postgres://user:password@host:port/dbname
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=your_secure_password
   SERVERNAME=server1
   ```

2. **Installation**:
   ```bash
   # Install backend requirements
   pip install -r backend/requirements.txt
   
   # Install frontend dependencies
   cd frontend && npm install --legacy-peer-deps
   
   # Install bot dependencies
   cd ../bot && npm install
   ```

3. **Build Frontend**:
   ```bash
   cd frontend && npm run build
   mkdir -p ../backend/static
   cp -r build/* ../backend/static/
   ```

4. **Run Application**:
   ```bash
   # Start the Python backend (Port 5000)
   cd backend
   python server.py
   ```

## Docker Deployment (Universal)
Build and run using the provided `package.json` Docker script or a custom Dockerfile.
```bash
docker build -t trekker-max .
docker run -p 5000:5000 --env-file .env trekker-max
```
