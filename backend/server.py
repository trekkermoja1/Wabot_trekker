"""
TREKKER MAX WABOT - Backend Server
Multi-Instance WhatsApp Bot Platform with Approval Workflow & Multi-Tenancy
"""
import os
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
    global db_pool
    
    try:
        # Parse the connection string for asyncpg
        import urllib.parse
        result = urllib.parse.urlparse(DATABASE_URL)
        
        db_pool = await asyncpg.create_pool(
            host=result.hostname,
            port=result.port,
            user=result.username,
            password=result.password,
            database=result.path[1:],  # Remove leading slash
            ssl='require',
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
            
        print(f"✓ Database initialized successfully for {SERVERNAME}")
        
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
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"http://localhost:{port}/status")
            return response.json()
    except:
        return {"status": "offline", "pairingCode": None}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print(f"🚀 TREKKER MAX WABOT Backend Starting on {SERVERNAME}...")
    await init_database()
    
    # Start expiration checker
    asyncio.create_task(check_expired_bots())
    
    # Stop all previously running instances on this server
    async with db_pool.acquire() as conn:
        # Check if pid column exists before updating
        try:
            await conn.execute("""
                UPDATE bot_instances
                SET pid = NULL, updated_at = NOW()
                WHERE server_name = $1
            """, SERVERNAME)
        except:
            # pid column might not exist in old schema, ignore
            pass
    
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
if os.path.exists("static"):
    app.mount("/_static", StaticFiles(directory="static"), name="static")


@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "TREKKER MAX WABOT",
        "version": "2.0.0",
        "server": SERVERNAME,
        "timestamp": datetime.utcnow().isoformat()
    }


@app.get("/api/server-info")
async def get_server_info():
    """Get current server information"""
    async with db_pool.acquire() as conn:
        total_bots = await conn.fetchval("""
            SELECT COUNT(*) FROM bot_instances WHERE server_name = $1
        """, SERVERNAME)
        
        new_bots = await conn.fetchval("""
            SELECT COUNT(*) FROM bot_instances 
            WHERE server_name = $1 AND status = 'new'
        """, SERVERNAME)
        
        approved_bots = await conn.fetchval("""
            SELECT COUNT(*) FROM bot_instances 
            WHERE server_name = $1 AND status = 'approved'
        """, SERVERNAME)
        
        expired_bots = await conn.fetchval("""
            SELECT COUNT(*) FROM bot_instances 
            WHERE server_name = $1 AND status = 'expired'
        """, SERVERNAME)
    
    return {
        "server_name": SERVERNAME,
        "total_bots": total_bots,
        "new_bots": new_bots,
        "approved_bots": approved_bots,
        "expired_bots": expired_bots
    }


@app.post("/api/login")
async def login(request: LoginRequest):
    if request.username == ADMIN_USERNAME and request.password == ADMIN_PASSWORD:
        return {"success": True, "message": "Login successful", "server": SERVERNAME}
    raise HTTPException(status_code=401, detail="Invalid username or password")


@app.post("/api/instances", response_model=InstanceResponse)
async def create_instance(request: CreateInstanceRequest):
    """Create a new bot instance in 'new' status"""
    instance_id = str(uuid.uuid4())[:8]
    
    async with db_pool.acquire() as conn:
        # Check if phone number already exists on this server
        existing = await conn.fetchrow("""
            SELECT id FROM bot_instances 
            WHERE phone_number = $1 AND server_name = $2
        """, request.phone_number, SERVERNAME)
        
        if existing:
            raise HTTPException(
                status_code=400, 
                detail="Phone number already registered on this server"
            )
        
        # Insert new instance with 'new' status
        await conn.execute("""
            INSERT INTO bot_instances 
            (id, name, phone_number, status, server_name, owner_id, created_at, updated_at)
            VALUES ($1, $2, $3, 'new', $4, $5, NOW(), NOW())
        """, instance_id, request.name, request.phone_number, SERVERNAME, request.owner_id)
    
    return InstanceResponse(
        id=instance_id,
        name=request.name,
        phone_number=request.phone_number,
        status="new",
        server_name=SERVERNAME,
        created_at=datetime.utcnow().isoformat()
    )


@app.post("/api/instances/{instance_id}/approve")
async def approve_instance(instance_id: str, request: ApproveInstanceRequest):
    """Approve a bot instance and set expiration"""
    if request.duration_months not in [1, 2, 3, 6, 12]:
        raise HTTPException(status_code=400, detail="Duration must be 1, 2, 3, 6, or 12 months")
    
    async with db_pool.acquire() as conn:
        # Get instance
        instance = await conn.fetchrow("""
            SELECT * FROM bot_instances 
            WHERE id = $1 AND server_name = $2
        """, instance_id, SERVERNAME)
        
        if not instance:
            raise HTTPException(status_code=404, detail="Instance not found")
        
        if instance['status'] != 'new':
            raise HTTPException(status_code=400, detail="Instance is not in 'new' status")
        
        # Calculate expiration date
        approved_at = datetime.utcnow()
        expires_at = approved_at + timedelta(days=30 * request.duration_months)
        
        # Allocate port
        port = get_next_port()
        
        # Update instance to approved
        await conn.execute("""
            UPDATE bot_instances
            SET status = 'approved',
                duration_months = $1,
                approved_at = $2,
                expires_at = $3,
                port = $4,
                updated_at = NOW()
            WHERE id = $5
        """, request.duration_months, approved_at, expires_at, port, instance_id)
        
        # Start the bot instance
        bot_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'bot')
        process = subprocess.Popen(
            ['node', 'instance.js', instance_id, instance['phone_number'], str(port)],
            cwd=bot_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        
        bot_processes[instance_id] = process
        instance_ports[instance_id] = port
        
        # Update PID
        await conn.execute("""
            UPDATE bot_instances SET pid = $1, updated_at = NOW()
            WHERE id = $2
        """, process.pid, instance_id)
    
    return {
        "message": "Instance approved and started",
        "instance_id": instance_id,
        "duration_months": request.duration_months,
        "expires_at": expires_at.isoformat(),
        "port": port
    }


@app.get("/api/instances")
async def list_instances(status: Optional[str] = None):
    """List all bot instances on this server, optionally filtered by status"""
    async with db_pool.acquire() as conn:
        if status:
            instances = await conn.fetch("""
                SELECT * FROM bot_instances 
                WHERE server_name = $1 AND status = $2
                ORDER BY created_at DESC
            """, SERVERNAME, status)
        else:
            instances = await conn.fetch("""
                SELECT * FROM bot_instances 
                WHERE server_name = $1
                ORDER BY created_at DESC
            """, SERVERNAME)
        
        result = []
        for instance in instances:
            port = instance['port']
            instance_id = instance['id']
            
            # Get live status if running
            status_data = {"status": instance['status']}
            if port and instance_id in bot_processes:
                status_data = await get_instance_status(instance_id, port)
            
            result.append({
                "id": instance['id'],
                "name": instance['name'],
                "phone_number": instance['phone_number'],
                "status": instance['status'],
                "server_name": instance['server_name'],
                "duration_months": instance['duration_months'],
                "created_at": instance['created_at'].isoformat() if instance['created_at'] else None,
                "approved_at": instance['approved_at'].isoformat() if instance['approved_at'] else None,
                "expires_at": instance['expires_at'].isoformat() if instance['expires_at'] else None,
                "pairing_code": status_data.get("pairingCode"),
                "connected_user": status_data.get("user"),
                "port": port
            })
    
    return {"instances": result, "total": len(result), "server": SERVERNAME}


@app.get("/api/instances/{instance_id}")
async def get_instance(instance_id: str):
    """Get details of a specific instance"""
    async with db_pool.acquire() as conn:
        instance = await conn.fetchrow("""
            SELECT * FROM bot_instances 
            WHERE id = $1 AND server_name = $2
        """, instance_id, SERVERNAME)
        
        if not instance:
            raise HTTPException(status_code=404, detail="Instance not found")
        
        port = instance['port']
        status_data = {"status": instance['status']}
        
        if port and instance_id in bot_processes:
            status_data = await get_instance_status(instance_id, port)
        
        return {
            "id": instance['id'],
            "name": instance['name'],
            "phone_number": instance['phone_number'],
            "status": instance['status'],
            "server_name": instance['server_name'],
            "duration_months": instance['duration_months'],
            "created_at": instance['created_at'].isoformat() if instance['created_at'] else None,
            "approved_at": instance['approved_at'].isoformat() if instance['approved_at'] else None,
            "expires_at": instance['expires_at'].isoformat() if instance['expires_at'] else None,
            "pairing_code": status_data.get("pairingCode"),
            "connected_user": status_data.get("user"),
            "port": port
        }


@app.get("/api/instances/{instance_id}/pairing-code")
async def get_pairing_code(instance_id: str):
    """Get pairing code for an instance"""
    async with db_pool.acquire() as conn:
        instance = await conn.fetchrow("""
            SELECT * FROM bot_instances 
            WHERE id = $1 AND server_name = $2
        """, instance_id, SERVERNAME)
        
        if not instance:
            raise HTTPException(status_code=404, detail="Instance not found")
        
        port = instance['port']
        if not port or instance_id not in bot_processes:
            return {
                "instance_id": instance_id,
                "pairing_code": None,
                "pairing_code_valid": False,
                "status": instance['status']
            }
        
        status_data = await get_instance_status(instance_id, port)
        
        return {
            "instance_id": instance_id,
            "pairing_code": status_data.get("pairingCode"),
            "pairing_code_valid": status_data.get("pairingCodeValid", False),
            "pairing_code_remaining_seconds": status_data.get("pairingCodeRemainingSeconds", 0),
            "status": status_data.get("status")
        }


@app.post("/api/instances/{instance_id}/regenerate-code")
async def regenerate_code(instance_id: str):
    """Regenerate pairing code for an instance"""
    async with db_pool.acquire() as conn:
        instance = await conn.fetchrow("""
            SELECT * FROM bot_instances 
            WHERE id = $1 AND server_name = $2
        """, instance_id, SERVERNAME)
        
        if not instance:
            raise HTTPException(status_code=404, detail="Instance not found")
        
        port = instance['port']
        if not port:
            raise HTTPException(status_code=400, detail="Instance has no port assigned")
        
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(f"http://localhost:{port}/regenerate-code")
                return response.json()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to communicate with bot: {str(e)}")


@app.post("/api/instances/{instance_id}/stop")
async def stop_instance(instance_id: str):
    """Stop a running instance (approved bots only)"""
    async with db_pool.acquire() as conn:
        instance = await conn.fetchrow("""
            SELECT * FROM bot_instances 
            WHERE id = $1 AND server_name = $2
        """, instance_id, SERVERNAME)
        
        if not instance:
            raise HTTPException(status_code=404, detail="Instance not found")
        
        if instance['status'] != 'approved':
            raise HTTPException(status_code=400, detail="Only approved bots can be stopped")
    
    if instance_id not in bot_processes:
        raise HTTPException(status_code=400, detail="Instance not running")
    
    try:
        process = bot_processes[instance_id]
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
        
        del bot_processes[instance_id]
        if instance_id in instance_ports:
            del instance_ports[instance_id]
        
        async with db_pool.acquire() as conn:
            await conn.execute("""
                UPDATE bot_instances SET pid = NULL, updated_at = NOW()
                WHERE id = $1
            """, instance_id)
        
        return {"message": "Instance stopped", "instance_id": instance_id}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to stop instance: {str(e)}")


@app.delete("/api/instances/{instance_id}")
async def delete_instance(instance_id: str):
    """Delete an instance (approved bots only)"""
    async with db_pool.acquire() as conn:
        instance = await conn.fetchrow("""
            SELECT * FROM bot_instances 
            WHERE id = $1 AND server_name = $2
        """, instance_id, SERVERNAME)
        
        if not instance:
            raise HTTPException(status_code=404, detail="Instance not found")
        
        if instance['status'] != 'approved':
            raise HTTPException(status_code=400, detail="Only approved bots can be deleted")
        
        # Stop if running
        if instance_id in bot_processes:
            try:
                process = bot_processes[instance_id]
                process.terminate()
                process.wait(timeout=5)
            except:
                pass
            del bot_processes[instance_id]
            if instance_id in instance_ports:
                del instance_ports[instance_id]
        
        # Delete instance directory
        import shutil
        bot_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'bot', 'instances', instance_id)
        if os.path.exists(bot_dir):
            shutil.rmtree(bot_dir)
        
        # Delete from database
        await conn.execute("""
            DELETE FROM bot_instances WHERE id = $1
        """, instance_id)
    
    return {"message": "Instance deleted", "instance_id": instance_id}


@app.post("/api/instances/{instance_id}/renew")
async def renew_instance(instance_id: str, request: ApproveInstanceRequest):
    """Renew an expired bot instance"""
    if request.duration_months not in [1, 2, 3, 6, 12]:
        raise HTTPException(status_code=400, detail="Duration must be 1, 2, 3, 6, or 12 months")
    
    async with db_pool.acquire() as conn:
        instance = await conn.fetchrow("""
            SELECT * FROM bot_instances 
            WHERE id = $1 AND server_name = $2
        """, instance_id, SERVERNAME)
        
        if not instance:
            raise HTTPException(status_code=404, detail="Instance not found")
        
        if instance['status'] != 'expired':
            raise HTTPException(status_code=400, detail="Instance is not expired")
        
        # Calculate new expiration
        approved_at = datetime.utcnow()
        expires_at = approved_at + timedelta(days=30 * request.duration_months)
        
        # Get port (reuse or allocate new)
        port = instance['port'] or get_next_port()
        
        # Update instance back to approved
        await conn.execute("""
            UPDATE bot_instances
            SET status = 'approved',
                duration_months = $1,
                approved_at = $2,
                expires_at = $3,
                port = $4,
                updated_at = NOW()
            WHERE id = $5
        """, request.duration_months, approved_at, expires_at, port, instance_id)
        
        # Restart the bot
        bot_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'bot')
        process = subprocess.Popen(
            ['node', 'instance.js', instance_id, instance['phone_number'], str(port)],
            cwd=bot_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        
        bot_processes[instance_id] = process
        instance_ports[instance_id] = port
        
        await conn.execute("""
            UPDATE bot_instances SET pid = $1, updated_at = NOW()
            WHERE id = $2
        """, process.pid, instance_id)
    
    return {
        "message": "Instance renewed and restarted",
        "instance_id": instance_id,
        "duration_months": request.duration_months,
        "expires_at": expires_at.isoformat()
    }


# Frontend routes
@app.get("/")
async def serve_index():
    return FileResponse("static/index.html")


@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    if full_path.startswith("api/") or full_path == "api":
        raise HTTPException(status_code=404)
    
    file_path = os.path.join("static", full_path)
    if os.path.isfile(file_path):
        return FileResponse(file_path)
    
    if full_path.startswith("static/"):
        relative_path = full_path[len("static/"):]
        static_sub_path = os.path.join("static/static", relative_path)
        if os.path.isfile(static_sub_path):
            return FileResponse(static_sub_path)
    
    return FileResponse("static/index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
