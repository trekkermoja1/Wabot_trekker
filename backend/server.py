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
    auto_start: Optional[bool] = True


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
        
        # Create tables
        async with db_pool.acquire() as conn:
            # Server Manager Table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS server_manager (
                    id SERIAL PRIMARY KEY,
                    server_name VARCHAR(50) UNIQUE NOT NULL,
                    bot_count INTEGER DEFAULT 0,
                    max_limit INTEGER DEFAULT 20,
                    last_heartbeat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    status VARCHAR(20) DEFAULT 'active'
                )
            """)

            # Bot Instances Table
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
            
            # Upsert current server into manager
            await conn.execute("""
                INSERT INTO server_manager (server_name, last_heartbeat)
                VALUES ($1, NOW())
                ON CONFLICT (server_name) DO UPDATE 
                SET last_heartbeat = NOW()
            """, SERVERNAME)
            
            # Create indexes...
            
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
    # Start server heartbeat
    asyncio.create_task(update_server_status())
    
    # Restart all approved instances on this server
    async with db_pool.acquire() as conn:
        approved_instances = await conn.fetch("""
            SELECT * FROM bot_instances 
            WHERE server_name = $1 AND status = 'approved'
        """, SERVERNAME)
        
        bot_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'bot')
        
        for instance in approved_instances:
            instance_id = instance['id']
            port = instance['port']
            if port:
                try:
                    # In Replit environment, we want logs in the console
                    process = subprocess.Popen(
                        ['node', 'instance.js', instance_id, instance['phone_number'], str(port)],
                        cwd=bot_dir,
                        stdout=None, # Inherit stdout
                        stderr=None, # Inherit stderr
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

MAX_BOTS_LIMIT = 20

async def update_server_status():
    """Background task to update server status and heartbeat"""
    while True:
        try:
            async with db_pool.acquire() as conn:
                # Count ONLY approved bots on THIS server
                count = await conn.fetchval("""
                    SELECT COUNT(*) FROM bot_instances 
                    WHERE server_name = $1 AND status = 'approved'
                """, SERVERNAME)
                
                # Update server_manager
                await conn.execute("""
                    UPDATE server_manager 
                    SET bot_count = $1, last_heartbeat = NOW(), 
                        status = CASE WHEN $1 >= max_limit THEN 'full' ELSE 'active' END
                    WHERE server_name = $2
                """, count, SERVERNAME)
        except Exception as e:
            print(f"Error updating server status: {e}")
        await asyncio.sleep(30)

async def find_available_server():
    """Find a server with capacity or return None"""
    async with db_pool.acquire() as conn:
        # Get best available server from manager (least busy first)
        # Based on approved bots count
        row = await conn.fetchrow("""
            SELECT server_name FROM server_manager 
            WHERE status = 'active' 
            AND last_heartbeat > NOW() - INTERVAL '2 minutes'
            ORDER BY bot_count ASC 
            LIMIT 1
        """)
        
        if row:
            return row['server_name']
            
        return None

@app.post("/api/instances", response_model=InstanceResponse)
async def create_instance(request: CreateInstanceRequest):
    async with db_pool.acquire() as conn:
        # Check if instance with this phone number already exists
        existing = await conn.fetchrow("SELECT id, server_name, port FROM bot_instances WHERE phone_number = $1", request.phone_number)
        
        if existing:
            instance_id = existing['id']
            target_server = existing['server_name']
            port = existing['port'] or get_next_port()
            
            # If it was on this server, stop the old process
            if instance_id in bot_processes:
                try:
                    bot_processes[instance_id].terminate()
                    await asyncio.sleep(1)
                except: pass
                del bot_processes[instance_id]
            
            # Update the existing record
            await conn.execute("""
                UPDATE bot_instances 
                SET name = $1, owner_id = $2, port = $3, status = 'new', updated_at = NOW() 
                WHERE id = $4
            """, request.name, request.owner_id, port, instance_id)
        else:
            # Find a server that has room
            target_server = await find_available_server()
            
            if not target_server:
                raise HTTPException(
                    status_code=400, 
                    detail=f"All servers are at maximum capacity ({MAX_BOTS_LIMIT} bots per server)."
                )

            instance_id = str(uuid.uuid4())[:8]
            port = get_next_port()
            
            # Store in database
            await conn.execute(
                "INSERT INTO bot_instances (id, name, phone_number, status, server_name, owner_id, port) VALUES ($1, $2, $3, 'new', $4, $5, $6)", 
                instance_id, request.name, request.phone_number, target_server, request.owner_id, port
            )

    # Store instance ID and port in memory for initialization if on this server
    instance_ports[instance_id] = port
    
    # Only start the process if the target server is THIS server and auto_start is True
    if target_server == SERVERNAME and request.auto_start:
        bot_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'bot')
        process = subprocess.Popen(
            ['node', 'instance.js', instance_id, request.phone_number, str(port)],
            cwd=bot_dir,
            stdout=None,
            stderr=None,
            start_new_session=True
        )
        bot_processes[instance_id] = process
    
    # Return instance data
    return InstanceResponse(
        id=instance_id, 
        name=request.name, 
        phone_number=request.phone_number, 
        status="new", 
        server_name=target_server, 
        created_at=datetime.utcnow().isoformat(),
        port=port
    )

@app.post("/api/instances/{instance_id}/finalize")
async def finalize_instance(instance_id: str, request: CreateInstanceRequest):
    # Use server_name from request or fallback
    target_server = getattr(request, 'server_name', SERVERNAME)
    
    async with db_pool.acquire() as conn:
        port = instance_ports.get(instance_id)
        await conn.execute(
            "INSERT INTO bot_instances (id, name, phone_number, status, server_name, owner_id, port) VALUES ($1, $2, $3, 'new', $4, $5, $6)", 
            instance_id, request.name, request.phone_number, target_server, request.owner_id, port
        )
    return {"message": f"Instance finalized and assigned to {target_server}"}

@app.post("/api/instances/{instance_id}/approve")
async def approve_instance(instance_id: str, request: ApproveInstanceRequest):
    async with db_pool.acquire() as conn:
        instance = await conn.fetchrow("SELECT * FROM bot_instances WHERE id = $1", instance_id)
        if not instance: raise HTTPException(status_code=404)
        
        port = instance['port'] or get_next_port()
        expires_at = datetime.utcnow() + timedelta(days=30 * request.duration_months)
        
        # 1. Update Database Registry (Global)
        await conn.execute("""
            UPDATE bot_instances 
            SET status = 'approved', 
                duration_months = $1, 
                approved_at = NOW(), 
                expires_at = $2, 
                port = $3,
                updated_at = NOW()
            WHERE id = $4
        """, request.duration_months, expires_at, port, instance_id)
        
        # 2. Local File Flag & Process Management (Only if on this server)
        if instance['server_name'] == SERVERNAME:
            bot_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'bot')
            flag_dir = os.path.join(bot_dir, 'instances', instance_id, 'data')
            os.makedirs(flag_dir, recursive=True)
            with open(os.path.join(flag_dir, 'approved.flag'), 'w') as f:
                f.write('approved')
            
            if instance_id in bot_processes:
                try:
                    bot_processes[instance_id].terminate()
                    bot_processes[instance_id].wait(timeout=2)
                except:
                    try: bot_processes[instance_id].kill()
                    except: pass
                del bot_processes[instance_id]

            process = subprocess.Popen(
                ['node', 'instance.js', instance_id, instance['phone_number'], str(port)],
                cwd=bot_dir,
                stdout=None,
                stderr=None,
                start_new_session=True
            )
            bot_processes[instance_id] = process
            instance_ports[instance_id] = port
            await conn.execute("UPDATE bot_instances SET pid = $1 WHERE id = $2", process.pid, instance_id)
            
        return {
            "message": "Approved in registry", 
            "expires_at": expires_at.isoformat(),
            "server_name": instance['server_name']
        }

@app.get("/api/instances")
async def list_instances(status: Optional[str] = None):
    async with db_pool.acquire() as conn:
        if status:
            instances = await conn.fetch("SELECT * FROM bot_instances WHERE status = $1 ORDER BY created_at DESC", status)
        else:
            instances = await conn.fetch("SELECT * FROM bot_instances ORDER BY created_at DESC")
        
        result = []
        for instance in instances:
            status_data = {"status": instance['status'], "pairingCode": None, "user": None}
            # Only try to fetch live status if it's on THIS server
            if instance['status'] == 'approved' and instance['port'] and instance['server_name'] == SERVERNAME:
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

async def start_instance_internal(instance_id: str, phone_number: str, port: int):
    """Helper to start a bot instance process"""
    bot_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'bot')
    try:
        # Check if process is already running and alive
        if instance_id in bot_processes:
            proc = bot_processes[instance_id]
            if proc.poll() is None:
                return True
            else:
                del bot_processes[instance_id]
        
        # In Replit environment, we want logs in the console
        process = subprocess.Popen(
            ['node', 'instance.js', instance_id, phone_number, str(port)],
            cwd=bot_dir,
            stdout=None,
            stderr=None,
            start_new_session=True
        )
        bot_processes[instance_id] = process
        instance_ports[instance_id] = port
        
        async with db_pool.acquire() as conn:
            await conn.execute("""
                UPDATE bot_instances SET pid = $1, updated_at = NOW()
                WHERE id = $2
            """, process.pid, instance_id)
        
        print(f"✅ Started bot instance {instance_id} on port {port}")
        
        # Verify it didn't crash immediately
        await asyncio.sleep(3)
        if process.poll() is not None:
            print(f"❌ Bot instance {instance_id} crashed immediately after start")
            return False
            
        return True
    except Exception as e:
        print(f"❌ Failed to start bot instance {instance_id}: {e}")
        return False

@app.get("/api/instances/{instance_id}/pairing-code")
async def get_pairing_code(instance_id: str):
    async with db_pool.acquire() as conn:
        instance = await conn.fetchrow("SELECT * FROM bot_instances WHERE id = $1", instance_id)
        
        # If not in DB, check memory for newly created/initializing instances
        if not instance:
            port = instance_ports.get(instance_id)
            if not port:
                raise HTTPException(status_code=404)
            
            status_data = await get_instance_status(instance_id, port)
            return {"pairing_code": status_data.get("pairingCode"), "status": status_data.get("status")}

        if not instance['port']:
            raise HTTPException(status_code=404)
        
        status_data = await get_instance_status(instance_id, instance['port'])
        
        # Auto-restart if offline
        if status_data.get("status") == "offline":
            print(f"🔄 Instance {instance_id} is offline, attempting auto-restart...")
            success = await start_instance_internal(instance_id, instance['phone_number'], instance['port'])
            if success:
                # Wait a bit more for the code to be generated
                await asyncio.sleep(3)
                status_data = await get_instance_status(instance_id, instance['port'])
        
        return {"pairing_code": status_data.get("pairingCode"), "status": status_data.get("status")}

@app.post("/api/instances/{instance_id}/regenerate-code")
async def regenerate_code(instance_id: str):
    async with db_pool.acquire() as conn:
        instance = await conn.fetchrow("SELECT * FROM bot_instances WHERE id = $1", instance_id)
        if not instance: raise HTTPException(status_code=404)
        
        # Ensure it's running before regenerating
        status_data = await get_instance_status(instance_id, instance['port'])
        if status_data.get("status") == "offline":
            await start_instance_internal(instance_id, instance['phone_number'], instance['port'])
            await asyncio.sleep(3)

        url = f"http://127.0.0.1:{instance['port']}/regenerate-code"
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(url)
                if response.status_code != 200:
                    return {"status": "error", "message": f"Instance returned {response.status_code}"}
                return response.json()
        except Exception as e:
            return {"status": "error", "message": str(e)}

@app.post("/api/instances/{instance_id}/start")
async def start_instance(instance_id: str):
    async with db_pool.acquire() as conn:
        instance = await conn.fetchrow("SELECT * FROM bot_instances WHERE id = $1", instance_id)
        if not instance:
            raise HTTPException(status_code=404, detail="Instance not found")
        
        if instance['server_name'] != SERVERNAME:
            raise HTTPException(status_code=400, detail=f"This instance is assigned to {instance['server_name']}")
        
        success = await start_instance_internal(instance_id, instance['phone_number'], instance['port'])
        if success:
            return {"message": "Instance started"}
        else:
            raise HTTPException(status_code=500, detail="Failed to start instance")

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
if os.path.exists("static"):
    app.mount("/static", StaticFiles(directory="static/static"), name="static")

@app.get("/{path_name:path}")
async def root(path_name: str = None):
    # API endpoints handled above, others serve frontend
    if path_name and path_name.startswith("api"):
        raise HTTPException(status_code=404)
    if os.path.exists("static/index.html"):
        return FileResponse("static/index.html")
    return {"message": "API Running"}

if __name__ == "__main__":
    import uvicorn
    # Change port back to 5000 to match webview exposure
    uvicorn.run(app, host="0.0.0.0", port=5000)
