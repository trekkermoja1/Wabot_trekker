import os
import urllib.parse
from dotenv import load_dotenv

# Load environment variables first
load_dotenv()

import subprocess
import uuid
import asyncio
import httpx
import asyncpg
from datetime import datetime, timedelta
from typing import Optional, Dict, List
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

# Environment configuration
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")
DATABASE_URL = os.environ.get("DATABASE_URL")
SERVERNAME = os.environ.get("SERVERNAME", "server1")

# Bot instances tracking
bot_processes: Dict[str, subprocess.Popen] = {}
instance_ports: Dict[str, int] = {}
port_counter = 4000

# Database pool
db_pool = None


# Pydantic models
class CreateInstanceRequest(BaseModel):
    name: str
    phone_number: str
    owner_id: Optional[str] = None


class ApproveInstanceRequest(BaseModel):
    duration_months: int  # Duration in months


class LoginRequest(BaseModel):
    username: str
    password: str


class InstanceResponse(BaseModel):
    id: str
    name: str
    phone_number: str
    status: str  # new, approved, expired
    server_name: str
    created_at: str
    approved_at: Optional[str] = None
    expires_at: Optional[str] = None
    duration_months: Optional[int] = None
    pairing_code: Optional[str] = None
    connected_user: Optional[dict] = None
    port: Optional[int] = None


async def init_database():
    """Initialize database connection and create tables"""
    global db_pool, port_counter
    
    try:
        # Parse the connection string for asyncpg
        result = urllib.parse.urlparse(DATABASE_URL)
        
        db_pool = await asyncpg.create_pool(
            host=result.hostname,
            port=result.port,
            user=result.username,
            password=result.password,
            database=result.path[1:],  # Remove leading slash
            min_size=2,
            max_size=10
        )
        
        # Create instances table
        async with db_pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS bot_instances (
                    id VARCHAR(50) PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    phone_number VARCHAR(50) NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'new',
                    server_name VARCHAR(50) NOT NULL,
                    owner_id VARCHAR(100),
                    port INTEGER,
                    pid INTEGER,
                    duration_months INTEGER,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    approved_at TIMESTAMP,
                    expires_at TIMESTAMP
                )
            """)
            
            # Create index on server_name for faster queries
            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_bot_instances_server_name 
                ON bot_instances(server_name)
            """)
            
            # Create index on status
            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_bot_instances_status 
                ON bot_instances(status)
            """)
            
            # Initialize port counter from max port in DB
            max_db_port = await conn.fetchval("SELECT MAX(port) FROM bot_instances")
            if max_db_port:
                port_counter = max(port_counter, max_db_port)
            
        print(f"✓ Database initialized successfully for {SERVERNAME}")
        print(f"✓ Port counter initialized at {port_counter}")
        
    except Exception as e:
        print(f"✗ Database initialization failed: {e}")
        raise


async def cleanup_instances():
    """Cleanup running bot processes on shutdown"""
    for instance_id, process in bot_processes.items():
        try:
            process.terminate()
            process.wait(timeout=5)
        except:
            process.kill()
    bot_processes.clear()
    instance_ports.clear()
    
    if db_pool:
        await db_pool.close()


async def check_expired_bots():
    """Background task to check and stop expired bots"""
    while True:
        try:
            await asyncio.sleep(60)  # Check every minute
            
            async with db_pool.acquire() as conn:
                # Find approved bots that have expired
                expired_bots = await conn.fetch("""
                    UPDATE bot_instances
                    SET status = 'expired', updated_at = NOW()
                    WHERE status = 'approved' 
                    AND expires_at <= NOW()
                    AND server_name = $1
                    RETURNING id
                """, SERVERNAME)
                
                # Stop processes for expired bots
                for record in expired_bots:
                    instance_id = record['id']
                    if instance_id in bot_processes:
                        try:
                            bot_processes[instance_id].terminate()
                            bot_processes[instance_id].wait(timeout=5)
                        except:
                            pass
                        del bot_processes[instance_id]
                        if instance_id in instance_ports:
                            del instance_ports[instance_id]
                    
                    print(f"⏰ Bot {instance_id} expired and stopped")
                    
        except Exception as e:
            print(f"Error in expiration check: {e}")


def get_next_port():
    """Get next available port for bot instance"""
    global port_counter
    port_counter += 1
    return port_counter


async def get_instance_status(instance_id: str, port: int) -> dict:
    """Get status from running bot instance"""
    url = f"http://127.0.0.1:{port}/status"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url)
            if response.status_code == 200:
                return response.json()
            return {"status": "offline", "pairingCode": None}
    except Exception as e:
        print(f"❌ Status error for {instance_id} on port {port}: {e}")
        return {"status": "offline", "pairingCode": None}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print(f"🚀 TREKKER MAX WABOT Backend Starting on {SERVERNAME}...")
    await init_database()
    
    # Start expiration checker
    asyncio.create_task(check_expired_bots())
    
    # Restart all approved instances on this server
    async with db_pool.acquire() as conn:
        approved_instances = await conn.fetch("""
            SELECT * FROM bot_instances 
            WHERE server_name = $1 AND status = 'approved'
        """, SERVERNAME)
        
        for instance in approved_instances:
            instance_id = instance['id']
            port = instance['port']
            if port:
                try:
                    bot_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'bot')
                    log_path = os.path.join(bot_dir, f"bot_{instance_id}.log")
                    log_file = open(log_path, "a", buffering=1)
                    process = subprocess.Popen(
                        ['node', 'instance.js', instance_id, instance['phone_number'], str(port)],
                        cwd=bot_dir,
                        stdout=log_file,
                        stderr=log_file,
                        start_new_session=True
                    )
                    bot_processes[instance_id] = process
                    instance_ports[instance_id] = port
                    await conn.execute("""
                        UPDATE bot_instances SET pid = $1, updated_at = NOW()
                        WHERE id = $2
                    """, process.pid, instance_id)
                    print(f"✅ Restarted bot instance {instance_id} on port {port}")
                    
                    # Wait for pairing code to be available if needed
                    await asyncio.sleep(2) 
                except Exception as e:
                    print(f"❌ Failed to restart bot instance {instance_id}: {e}")
    yield
    await cleanup_instances()


app = FastAPI(
    title="TREKKER MAX WABOT",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/server-info")
async def get_server_info():
    async with db_pool.acquire() as conn:
        total = await conn.fetchval("SELECT COUNT(*) FROM bot_instances WHERE server_name = $1", SERVERNAME)
        new = await conn.fetchval("SELECT COUNT(*) FROM bot_instances WHERE server_name = $1 AND status = 'new'", SERVERNAME)
        approved = await conn.fetchval("SELECT COUNT(*) FROM bot_instances WHERE server_name = $1 AND status = 'approved'", SERVERNAME)
        expired = await conn.fetchval("SELECT COUNT(*) FROM bot_instances WHERE server_name = $1 AND status = 'expired'", SERVERNAME)
    return {"server_name": SERVERNAME, "total_bots": total, "new_bots": new, "approved_bots": approved, "expired_bots": expired}

@app.post("/api/login")
async def login(request: LoginRequest):
    if request.username == ADMIN_USERNAME and request.password == ADMIN_PASSWORD:
        return {"success": True, "message": "Login successful"}
    raise HTTPException(status_code=401)

@app.post("/api/instances", response_model=InstanceResponse)
async def create_instance(request: CreateInstanceRequest):
    instance_id = str(uuid.uuid4())[:8]
    async with db_pool.acquire() as conn:
        await conn.execute("INSERT INTO bot_instances (id, name, phone_number, status, server_name, owner_id) VALUES ($1, $2, $3, 'new', $4, $5)", instance_id, request.name, request.phone_number, SERVERNAME, request.owner_id)
    return InstanceResponse(id=instance_id, name=request.name, phone_number=request.phone_number, status="new", server_name=SERVERNAME, created_at=datetime.utcnow().isoformat())

@app.post("/api/instances/{instance_id}/approve")
async def approve_instance(instance_id: str, request: ApproveInstanceRequest):
    async with db_pool.acquire() as conn:
        instance = await conn.fetchrow("SELECT * FROM bot_instances WHERE id = $1", instance_id)
        if not instance: raise HTTPException(status_code=404)
        port = get_next_port()
        expires_at = datetime.utcnow() + timedelta(days=30 * request.duration_months)
        await conn.execute("UPDATE bot_instances SET status = 'approved', duration_months = $1, approved_at = NOW(), expires_at = $2, port = $3 WHERE id = $4", request.duration_months, expires_at, port, instance_id)
        bot_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'bot')
        log_file = open(os.path.join(bot_dir, f"bot_{instance_id}.log"), "a", buffering=1)
        process = subprocess.Popen(['node', 'instance.js', instance_id, instance['phone_number'], str(port)], cwd=bot_dir, stdout=log_file, stderr=log_file, start_new_session=True)
        bot_processes[instance_id] = process
        instance_ports[instance_id] = port
    return {"message": "Approved"}

@app.get("/api/instances")
async def list_instances(status: Optional[str] = None):
    async with db_pool.acquire() as conn:
        if status:
            instances = await conn.fetch("SELECT * FROM bot_instances WHERE server_name = $1 AND status = $2 ORDER BY created_at DESC", SERVERNAME, status)
        else:
            instances = await conn.fetch("SELECT * FROM bot_instances WHERE server_name = $1 ORDER BY created_at DESC", SERVERNAME)
        
        result = []
        for instance in instances:
            status_data = {"status": instance['status'], "pairingCode": None, "user": None}
            if instance['status'] == 'approved' and instance['port']:
                status_data = await get_instance_status(instance['id'], instance['port'])
            
            result.append({
                "id": instance['id'],
                "name": instance['name'],
                "phone_number": instance['phone_number'],
                "status": status_data.get("status", instance['status']),
                "server_name": instance['server_name'],
                "owner_id": instance['owner_id'],
                "port": instance['port'],
                "pairing_code": status_data.get("pairingCode"),
                "connected_user": status_data.get("user"),
                "created_at": instance['created_at'].isoformat(),
                "approved_at": instance['approved_at'].isoformat() if instance['approved_at'] else None,
                "expires_at": instance['expires_at'].isoformat() if instance['expires_at'] else None,
                "duration_months": instance['duration_months']
            })
    return {"instances": result}

@app.get("/api/instances/{instance_id}/pairing-code")
async def get_pairing_code(instance_id: str):
    async with db_pool.acquire() as conn:
        instance = await conn.fetchrow("SELECT * FROM bot_instances WHERE id = $1", instance_id)
        if not instance or not instance['port']: raise HTTPException(status_code=404)
        status_data = await get_instance_status(instance_id, instance['port'])
        return {"pairing_code": status_data.get("pairingCode"), "status": status_data.get("status")}

@app.post("/api/instances/{instance_id}/regenerate-code")
async def regenerate_code(instance_id: str):
    async with db_pool.acquire() as conn:
        instance = await conn.fetchrow("SELECT * FROM bot_instances WHERE id = $1", instance_id)
        if not instance: raise HTTPException(status_code=404)
        url = f"http://127.0.0.1:{instance['port']}/regenerate-code"
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url)
            return response.json()

@app.post("/api/instances/{instance_id}/stop")
async def stop_instance(instance_id: str):
    if instance_id in bot_processes:
        bot_processes[instance_id].terminate()
        del bot_processes[instance_id]
    return {"message": "Stopped"}

@app.delete("/api/instances/{instance_id}")
async def delete_instance(instance_id: str):
    async with db_pool.acquire() as conn:
        await conn.execute("DELETE FROM bot_instances WHERE id = $1", instance_id)
    if instance_id in bot_processes:
        bot_processes[instance_id].terminate()
        del bot_processes[instance_id]
    return {"message": "Deleted"}

# Serve static files
if os.path.exists("../frontend/build"):
    app.mount("/static", StaticFiles(directory="../frontend/build/static"), name="static")

@app.get("/{path_name:path}")
async def root(path_name: str = None):
    # API endpoints handled above, others serve frontend
    if path_name and path_name.startswith("api"):
        raise HTTPException(status_code=404)
    if os.path.exists("../frontend/build/index.html"):
        return FileResponse("../frontend/build/index.html")
    return {"message": "API Running"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)
