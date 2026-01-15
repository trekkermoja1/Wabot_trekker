import os
import urllib.parse
from dotenv import load_dotenv

# Load environment variables first
load_dotenv()

import subprocess
import uuid
import asyncio
from datetime import datetime, timedelta
from typing import Optional, Dict, List
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import httpx
import asyncpg

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
        
        # Replit's built-in PostgreSQL does not use SSL
        ssl_context = None
        
        db_pool = await asyncpg.create_pool(
            host=result.hostname,
            port=result.port,
            user=result.username,
            password=result.password,
            database=result.path[1:],  # Remove leading slash
            ssl=ssl_context,
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
    # Use 127.0.0.1 explicitly to avoid IPv6 issues if any
    url = f"http://127.0.0.1:{port}/status"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(url)
            data = response.json()
            # print(f"🤖 Bot {instance_id} status on port {port}: {data.get('status')} | Code: {data.get('pairingCode')}")
            return data
    except Exception as e:
        # print(f"❌ Error communicating with bot {instance_id} on port {port} at {url}: {e}")
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
                    # Start the bot instance
                    bot_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'bot')
                    log_path = os.path.join(bot_dir, f"bot_{instance_id}.log")
                    log_file = open(log_path, "a", buffering=1)
                    print(f"🚀 Starting bot {instance_id} on port {port}, logging to {log_path}")
                    process = subprocess.Popen(
                        ['node', 'instance.js', instance_id, instance['phone_number'], str(port)],
                        cwd=bot_dir,
                        stdout=log_file,
                        stderr=log_file,
                        start_new_session=True
                    )
                    bot_processes[instance_id] = process
                    instance_ports[instance_id] = port
                    
                    # Update PID
                    await conn.execute("""
                        UPDATE bot_instances SET pid = $1, updated_at = NOW()
                        WHERE id = $2
                    """, process.pid, instance_id)
                    print(f"✅ Restarted bot instance {instance_id} on port {port}")
                except Exception as e:
                    print(f"❌ Failed to restart bot instance {instance_id}: {e}")
    
    yield
    
    # Shutdown
    await cleanup_instances()
    print("👋 TREKKER MAX WABOT Backend Shutting Down...")


app = FastAPI(
    title="TREKKER MAX WABOT",
    description="Multi-Instance WhatsApp Bot Platform with Approval Workflow",
    version="2.0.0",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static files
if os.path.exists("../frontend/build"):
    app.mount("/static", StaticFiles(directory="../frontend/build/static"), name="static")

@app.get("/")
async def root():
    if os.path.exists("../frontend/build/index.html"):
        return FileResponse("../frontend/build/index.html")
    return {"message": "TREKKER MAX WABOT API is running"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)
