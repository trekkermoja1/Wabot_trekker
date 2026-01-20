# TREKKER MAX WABOT - Commercial Deployment Guide

## Prerequisites
- Node.js (v20+)
- Python (v3.11+) - **Must be installed on the host machine**
- PostgreSQL Database

## Deployment on Node-Only Platforms (PaaS/Panels)
If your environment (like some Heroku-like panels or Node-only PaaS) does not natively support Python in its default runtime, you must ensure the environment has a **Python Buildpack** or **System Dependency** enabled.

### 1. Ensure Python is available
On most "Node-only" environments, you can add Python by:
- Adding a `python` buildpack in the dashboard.
- Installing it via the system package manager if you have root access.

### 2. Verify Python Path
The application expects `python` or `python3` to be in the system PATH.

## Local/VPS Setup
1. **Environment Variables**: Create a `.env` file in the root.
   ```env
   DATABASE_URL=postgres://user:password@host:port/dbname
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=your_secure_password
   SERVERNAME=server1
   ```

2. **Installation & Build**:
   ```bash
   npm install
   npm run build:frontend
   ```

3. **Run Application**:
   ```bash
   npm start
   ```

## Docker Deployment (Recommended for Commercial)
Using Docker is the best way to run this on "any" environment because the image contains both Node and Python regardless of the host.
```bash
docker build -t trekker-max .
docker run -p 5000:5000 --env-file .env trekker-max
```
