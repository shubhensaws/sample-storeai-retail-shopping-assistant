"""Whisper live transcription server — single port serving HTTP health + WebSocket."""
import asyncio
import json
import numpy as np
import os
import threading
import time
from aiohttp import web
from faster_whisper import WhisperModel

MODEL_SIZE = os.environ.get("WHISPER_MODEL", "large-v3")
SAMPLE_RATE = 16000
MIN_CHUNK_SEC = 1.0
BUFFER_CAP_SEC = 45
BUFFER_TRIM_SEC = 30
SAME_OUTPUT_THRESHOLD = 7
PORT = int(os.environ.get("PORT", "8765"))
PATH_PREFIX = os.environ.get("PATH_PREFIX", "/whisper")

print(f"Loading Whisper {MODEL_SIZE}...")
model = WhisperModel(MODEL_SIZE, device="cuda", compute_type="float16")
print(f"Model loaded! Serving on :{PORT} (health: {PATH_PREFIX}/health, ws: {PATH_PREFIX})")

# --- Cognito auth (env-gated; only enforced when COGNITO_USER_POOL_ID is set) ---
_COG_POOL = os.environ.get("COGNITO_USER_POOL_ID", "")
_COG_REGION = os.environ.get("COGNITO_REGION", os.environ.get("AWS_REGION", "us-east-2"))
_COG_CLIENT = os.environ.get("COGNITO_APP_CLIENT_ID", "")
_AUTH_ENABLED = bool(_COG_POOL)
_JWKS = None
if _AUTH_ENABLED:
    print(f"[WHISPER] Cognito auth ENABLED (pool={_COG_POOL})", flush=True)


def _verify_cognito(token):
    global _JWKS
    import jwt, urllib.request
    if _JWKS is None:
        url = f"https://cognito-idp.{_COG_REGION}.amazonaws.com/{_COG_POOL}/.well-known/jwks.json"
        with urllib.request.urlopen(url, timeout=5) as r:
            _JWKS = json.loads(r.read())
    hdr = jwt.get_unverified_header(token)
    key = next((k for k in _JWKS["keys"] if k["kid"] == hdr["kid"]), None)
    if key is None:  # kid rotation — refetch JWKS once
        url = f"https://cognito-idp.{_COG_REGION}.amazonaws.com/{_COG_POOL}/.well-known/jwks.json"
        with urllib.request.urlopen(url, timeout=5) as r:
            _JWKS = json.loads(r.read())
        key = next((k for k in _JWKS["keys"] if k["kid"] == hdr["kid"]), None)
    if key is None:
        raise ValueError("signing key not found")
    pub = jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(key))
    return jwt.decode(token, pub, algorithms=["RS256"], audience=_COG_CLIENT or None,
                      issuer=f"https://cognito-idp.{_COG_REGION}.amazonaws.com/{_COG_POOL}",
                      options={"verify_aud": bool(_COG_CLIENT)})


def _authorized(request):
    """WS auth: token via ?token= query param (browsers can't set WS headers)."""
    if not _AUTH_ENABLED:
        return True
    token = request.query.get("token", "") or ""
    if not token:
        h = request.headers.get("authorization", "")
        token = h[7:].strip() if h.lower().startswith("bearer ") else h.strip()
    if not token:
        return False
    try:
        _verify_cognito(token)
        return True
    except Exception as e:  # noqa: BLE001
        print(f"[WHISPER] ✗ auth rejected: {e}", flush=True)
        return False


class TranscriptionSession:
    def __init__(self, ws):
        self.ws = ws
        self.lock = threading.Lock()
        self.frames = None
        self.frames_offset = 0.0
        self.ts_offset = 0.0
        self.prev_out = ""
        self.same_count = 0
        self.exit = False
        self.loop = None

    def add_frames(self, chunk: np.ndarray):
        with self.lock:
            if self.frames is not None and self.frames.shape[0] > BUFFER_CAP_SEC * SAMPLE_RATE:
                self.frames_offset += BUFFER_TRIM_SEC
                self.frames = self.frames[int(BUFFER_TRIM_SEC * SAMPLE_RATE):]
                if self.ts_offset < self.frames_offset:
                    self.ts_offset = self.frames_offset
            self.frames = chunk.copy() if self.frames is None else np.concatenate((self.frames, chunk))

    def get_audio(self):
        with self.lock:
            if self.frames is None:
                return None, 0.0
            skip = max(0, int((self.ts_offset - self.frames_offset) * SAMPLE_RATE))
            audio = self.frames[skip:].copy()
            return audio, audio.shape[0] / SAMPLE_RATE

    def _send(self, msg):
        if self.loop and not self.loop.is_closed():
            asyncio.run_coroutine_threadsafe(self.ws.send_json(msg), self.loop)

    def transcribe_loop(self):
        while not self.exit:
            audio, duration = self.get_audio()
            if audio is None or duration < MIN_CHUNK_SEC:
                time.sleep(0.1)
                continue
            segments, _ = model.transcribe(audio, beam_size=5, language=None, task="translate", vad_filter=True)
            seg_list = list(segments)
            if not seg_list:
                with self.lock:
                    self.ts_offset += duration
                time.sleep(0.2)
                continue
            print(f"[WHISPER] 🎤 request active — {duration:.1f}s audio → {len(seg_list)} segment(s); latest={seg_list[-1].text.strip()!r}", flush=True)
            offset_advance = 0.0
            for seg in seg_list[:-1]:
                text = seg.text.strip()
                if text:
                    self._send({"text": text, "completed": True})
                    offset_advance = seg.end
            last = seg_list[-1]
            current = last.text.strip()
            if current:
                self._send({"text": current, "completed": False})
            if current == self.prev_out and current:
                self.same_count += 1
                if self.same_count > SAME_OUTPUT_THRESHOLD:
                    self._send({"text": current, "completed": True})
                    offset_advance = last.end
                    self.same_count = 0
                    current = ""
            else:
                self.same_count = 0
            self.prev_out = current
            if offset_advance > 0:
                with self.lock:
                    self.ts_offset += offset_advance
            time.sleep(0.05)


async def websocket_handler(request):
    if not _authorized(request):
        return web.Response(status=401, text="unauthorized")
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    print(f"[WHISPER] ▶ client connected: {request.remote}", flush=True)
    session = TranscriptionSession(ws)
    session.loop = asyncio.get_event_loop()
    t = threading.Thread(target=session.transcribe_loop, daemon=True)
    t.start()
    try:
        async for msg in ws:
            if msg.type == web.WSMsgType.BINARY:
                audio = np.frombuffer(msg.data, dtype=np.int16).astype(np.float32) / 32768.0
                session.add_frames(audio)
    finally:
        session.exit = True
        t.join(timeout=3)
        print(f"[WHISPER] ⏹ client disconnected: {request.remote}", flush=True)
    return ws


async def health_handler(request):
    return web.json_response({"status": "ok", "model": MODEL_SIZE})


async def test_page_handler(request):
    return web.FileResponse(os.path.join(os.path.dirname(__file__), "test_client.html"))


app = web.Application()
app.router.add_get(f"{PATH_PREFIX}/health", health_handler)
app.router.add_get("/health", health_handler)
app.router.add_get(f"{PATH_PREFIX}/test", test_page_handler)
app.router.add_get(PATH_PREFIX, websocket_handler)

if __name__ == "__main__":
    web.run_app(app, host="0.0.0.0", port=PORT)
