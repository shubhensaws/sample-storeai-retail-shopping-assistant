"""LiveAvatar relay server — HTTP + WebSocket on port 8502.

Serves the avatar HTML page, proxies HeyGen LiveAvatar token API,
and relays text from the chat frontend → browser avatar page.
"""
import asyncio, json, os, pathlib
import aiohttp
from aiohttp import web

LIVEAVATAR_API = "https://api.liveavatar.com/v1"
API_KEY = os.getenv("LIVEAVATAR_API_KEY", "")
PORT = int(os.getenv("LIVEAVATAR_PORT", "8502"))
HTML_PATH = pathlib.Path(__file__).parent / "liveavatar_avatar.html"

_clients: set[web.WebSocketResponse] = set()


async def index(request):
    return web.FileResponse(HTML_PATH)


async def health(request):
    return web.json_response({"status": "ok"})


async def avatars(request):
    """Return curated avatar list for the dropdown."""
    curated = [
        {"id": "f86e8b45-3389-424a-b3d7-7f6e8729e36d", "name": "Marianne in Black Suit"},
        {"id": "8532b602-89e8-44fa-a9e2-5a4259a058cc", "name": "Marianne in Red Suit"},
        {"id": "246e8d9d-5826-4f49-b8a0-07cb73ff7556", "name": "Thaddeus in Black Suit"},
        {"id": "b4fc2d60-3b82-4694-b243-93e9d2bb0242", "name": "Anastasia in Grey Shirt"},
        {"id": "ab0765ad-69de-41fb-9f8a-bd01c3c52d6f", "name": "Alessandra in Grey Sweater"},
        {"id": "7001c332-8101-4e5a-b695-eac2a72d9568", "name": "Pedro in Blue Shirt"},
        {"id": "7a517e8e-b41f-49e7-b6b3-2cdfb4bbff1e", "name": "Pedro Sitting"},
        {"id": "5dd4d830-957a-419f-9334-0dc4399ada5d", "name": "Rika Sitting"},
        {"id": "509609b9-cda3-4f74-b1b2-97b4d98834fd", "name": "Anthony in White Suit"},
        {"id": "bfed3e3e-7d44-4fdb-b2be-ce9a9fd0b9b5", "name": "Amina in Blue Suit"},
        {"id": "03f8332d-9046-42a1-bff3-3b2309f77b58", "name": "Graham in Black Suit"},
        {"id": "9650a758-1085-4d49-8bf3-f347565ec229", "name": "Silas HR"},
        {"id": "7b888024-f8c9-4205-95e1-78ce01497bda", "name": "Shawn Therapist"},
    ]
    return web.json_response(curated)


async def token(request):
    """Create HeyGen session token — the SDK calls start internally."""
    body = await request.json()
    avatar_id = body.get("avatar_id")
    voice_id = body.get("voice_id", "")
    if not avatar_id:
        return web.json_response({"error": "avatar_id required"}, status=400)

    headers = {"X-API-KEY": API_KEY, "accept": "application/json", "content-type": "application/json", "User-Agent": "StoreAI/2.0"}
    token_body = {"mode": "FULL", "avatar_id": avatar_id,
                  "avatar_persona": {"language": "en"},
                  "max_session_length": 1800}
    if voice_id:
        token_body["avatar_persona"]["voice_id"] = voice_id

    async with aiohttp.ClientSession() as s:
        async with s.post(f"{LIVEAVATAR_API}/sessions/token", headers=headers, json=token_body) as r:
            token_data = await r.json()

    if "data" not in token_data or not token_data.get("data"):
        return web.json_response({"error": "token creation failed", "detail": token_data}, status=500)

    return web.json_response({"session_token": token_data["data"]["session_token"]})


async def ws_handler(request):
    """WebSocket relay: chat frontend sends text, browser avatar clients receive it."""
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    role = request.query.get("role", "browser")

    if role == "browser":
        _clients.add(ws)
    try:
        async for msg in ws:
            if msg.type == aiohttp.WSMsgType.TEXT:
                if role == "streamlit":
                    for c in list(_clients):
                        if not c.closed:
                            await c.send_str(msg.data)
    finally:
        _clients.discard(ws)
    return ws


app = web.Application()
app.router.add_get("/", index)
app.router.add_get("/health", health)
app.router.add_get("/avatar", index)
app.router.add_get("/avatars", avatars)
app.router.add_post("/token", token)
app.router.add_get("/ws", ws_handler)

if __name__ == "__main__":
    print(f"LiveAvatar relay server on http://localhost:{PORT}")
    web.run_app(app, port=PORT)
