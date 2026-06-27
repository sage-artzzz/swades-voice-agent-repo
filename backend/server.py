import asyncio
import datetime
import json
import logging
import os
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from livekit.api import AccessToken, VideoGrants, LiveKitAPI

from db import init_db, get_call_summary, get_all_appointments

load_dotenv()
logger = logging.getLogger("server")

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory store of active monitoring websockets keyed by room name
_monitor_connections: dict[str, list[WebSocket]] = {}


@app.on_event("startup")
async def startup():
    await init_db()


def _livekit_token(room_name: str, identity: str, is_agent: bool = False) -> str:
    api_key = os.environ.get("LIVEKIT_API_KEY", "")
    api_secret = os.environ.get("LIVEKIT_API_SECRET", "")

    grants = VideoGrants(
        room_join=True,
        room=room_name,
        can_publish=True,
        can_subscribe=True,
        can_publish_data=True,
    )

    token = (
        AccessToken(api_key, api_secret)
        .with_identity(identity)
        .with_name(identity)
        .with_grants(grants)
        .with_ttl(datetime.timedelta(hours=1))
        .to_jwt()
    )
    return token


@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/api/token")
async def get_token(room: str, identity: str):
    """Generate a LiveKit JWT for a caller or watcher to join a room."""
    if not room or not identity:
        raise HTTPException(status_code=400, detail="room and identity are required")
    token = _livekit_token(room, identity)
    return {
        "token": token,
        "url": os.environ.get("LIVEKIT_URL", ""),
        "room": room,
        "identity": identity,
    }


@app.get("/api/appointments")
async def list_appointments():
    """Return all booked appointments."""
    return await get_all_appointments()


@app.get("/api/summary/{room_name}")
async def get_summary(room_name: str):
    """Fetch the post-call summary for a room."""
    summary = await get_call_summary(room_name)
    if not summary:
        raise HTTPException(status_code=404, detail="No summary found for this room")
    return summary


@app.websocket("/ws/monitor/{room_name}")
async def monitor_ws(websocket: WebSocket, room_name: str):
    """
    WebSocket endpoint for the monitoring UI.
    Clients connect here to receive real-time transcript and agent state events.
    The agent publishes these via LiveKit data messages; this server bridges them.
    """
    await websocket.accept()
    _monitor_connections.setdefault(room_name, []).append(websocket)
    logger.info("Monitor connected for room: %s", room_name)
    try:
        while True:
            # Keep connection alive; events come from broadcast_to_monitors
            await asyncio.sleep(30)
            await websocket.send_json({"type": "ping"})
    except WebSocketDisconnect:
        _monitor_connections[room_name].remove(websocket)
        logger.info("Monitor disconnected from room: %s", room_name)


@app.post("/api/monitor/event")
async def receive_monitor_event(payload: dict):
    """
    The agent backend calls this to broadcast monitoring events to all
    connected monitor WebSocket clients for a given room.
    """
    room_name = payload.get("room")
    if not room_name:
        return {"ok": False}

    clients = _monitor_connections.get(room_name, [])
    dead = []
    for ws in clients:
        try:
            await ws.send_json(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.remove(ws)

    return {"ok": True, "sent_to": len(clients)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
