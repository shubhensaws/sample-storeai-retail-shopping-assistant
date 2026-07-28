"""
Nova Sonic STT+TTS WebSocket server.

Two modes via separate WebSocket endpoints:
  /stt  — User speaks → Nova Sonic transcribes → returns text (live partials + final)
  /tts  — Send text → Nova Sonic speaks → returns audio chunks

Runs as a standalone FastAPI server (default port 8505).
"""
import asyncio, base64, json, os, uuid, logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from aws_sdk_bedrock_runtime.client import (
    BedrockRuntimeClient, InvokeModelWithBidirectionalStreamOperationInput,
)
from aws_sdk_bedrock_runtime.models import (
    InvokeModelWithBidirectionalStreamInputChunk, BidirectionalInputPayloadPart,
)
from aws_sdk_bedrock_runtime.config import Config as BedrockConfig

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("nova-sonic")

# --- Cognito auth (env-gated; only enforced when COGNITO_USER_POOL_ID is set) ---
_COG_POOL = os.environ.get("COGNITO_USER_POOL_ID", "")
_COG_REGION = os.environ.get("COGNITO_REGION", os.environ.get("AWS_REGION", "us-east-2"))
_COG_CLIENT = os.environ.get("COGNITO_APP_CLIENT_ID", "")
_AUTH_ENABLED = bool(_COG_POOL)
_JWKS = None
if _AUTH_ENABLED:
    logger.info(f"[NOVA] Cognito auth ENABLED (pool={_COG_POOL})")


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


async def _authorized_ws(ws: WebSocket) -> bool:
    """WS auth via ?token= query param (browsers can't set WS headers). Rejects the
    handshake with close() before accept() when invalid."""
    if not _AUTH_ENABLED:
        return True
    token = ws.query_params.get("token", "")
    if not token:
        await ws.close(code=1008)
        return False
    try:
        _verify_cognito(token)
        return True
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[NOVA] ✗ auth rejected: {e}")
        await ws.close(code=1008)
        return False

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.get("/health")
async def health():
    return {"status": "ok"}

REGION = os.getenv("NOVA_SONIC_REGION", "us-east-1")
MODEL_ID = os.getenv("NOVA_SONIC_MODEL_ID", "amazon.nova-sonic-v1:0")

from smithy_aws_core.identity.chain import ChainedIdentityResolver
from smithy_aws_core.identity.container import ContainerCredentialsResolver
from smithy_aws_core.identity.environment import EnvironmentCredentialsResolver
from smithy_http.aio.aiohttp import AIOHTTPClient

# --- Helpers ---

_http_client = None
_creds_resolver = None

def _get_creds_resolver():
    global _http_client, _creds_resolver
    if _creds_resolver is None:
        _http_client = AIOHTTPClient()
        _creds_resolver = ChainedIdentityResolver([
            ContainerCredentialsResolver(http_client=_http_client),
            EnvironmentCredentialsResolver(),
        ])
    return _creds_resolver

def _make_client():
    return BedrockRuntimeClient(BedrockConfig(
        endpoint_uri=f"https://bedrock-runtime.{REGION}.amazonaws.com",
        region=REGION,
        aws_credentials_identity_resolver=_get_creds_resolver(),
    ))

async def _send(stream, event: dict):
    raw = json.dumps({"event": event}).encode("utf-8")
    await stream.input_stream.send(
        InvokeModelWithBidirectionalStreamInputChunk(value=BidirectionalInputPayloadPart(bytes_=raw))
    )

# --- STT endpoint: browser streams audio, server returns transcript ---

@app.websocket("/stt")
async def stt_endpoint(ws: WebSocket):
    if not await _authorized_ws(ws):
        return
    await ws.accept()
    logger.info("[NOVA-STT] ▶ client connected (STT-only mode — transcription, no audio output)")
    client = _make_client()
    prompt = str(uuid.uuid4())
    audio_content = str(uuid.uuid4())
    system_content = str(uuid.uuid4())

    try:
        logger.info("STT: opening Bedrock stream...")
        try:
            stream = await client.invoke_model_with_bidirectional_stream(
                InvokeModelWithBidirectionalStreamOperationInput(model_id=MODEL_ID)
            )
        except BaseException as e:
            logger.error(f"STT: Bedrock stream FAILED: {type(e).__name__}: {e}", exc_info=True)
            await ws.close()
            return
        logger.info("STT: Bedrock stream opened")

        # Session start
        await _send(stream, {"sessionStart": {"inferenceConfiguration": {"maxTokens": 128, "topP": 0.9, "temperature": 0.1}}})

        # Prompt start — text output only (no audio output = STT only mode)
        # We still need audioOutput config because Nova Sonic requires it, but we'll ignore the audio
        await _send(stream, {"promptStart": {
            "promptName": prompt,
            "textOutputConfiguration": {"mediaType": "text/plain"},
            "audioOutputConfiguration": {
                "mediaType": "audio/lpcm", "sampleRateHertz": 24000,
                "sampleSizeBits": 16, "channelCount": 1, "voiceId": "matthew",
                "encoding": "base64", "audioType": "SPEECH",
            },
        }})

        # System prompt — tell it to just transcribe
        await _send(stream, {"contentStart": {
            "promptName": prompt, "contentName": system_content,
            "type": "TEXT", "interactive": False, "role": "SYSTEM",
            "textInputConfiguration": {"mediaType": "text/plain"},
        }})
        await _send(stream, {"textInput": {
            "promptName": prompt, "contentName": system_content,
            "content": "You are a speech transcription assistant. Listen to the user's speech and repeat back exactly what they said, word for word. Do not add anything else. If the user speaks Hindi, transcribe in English.",
        }})
        await _send(stream, {"contentEnd": {"promptName": prompt, "contentName": system_content}})

        # Audio input start
        await _send(stream, {"contentStart": {
            "promptName": prompt, "contentName": audio_content,
            "type": "AUDIO", "interactive": True, "role": "USER",
            "audioInputConfiguration": {
                "mediaType": "audio/lpcm", "sampleRateHertz": 16000,
                "sampleSizeBits": 16, "channelCount": 1,
                "audioType": "SPEECH", "encoding": "base64",
            },
        }})

        active = True

        # Browser → Nova Sonic (audio)
        async def send_audio():
            nonlocal active
            try:
                while active:
                    raw = await ws.receive_text()
                    msg = json.loads(raw)
                    if msg.get("type") == "stop":
                        logger.info("STT: client sent stop")
                        active = False
                        break
                    if msg.get("type") == "audio" and msg.get("data"):
                        await _send(stream, {"audioInput": {
                            "promptName": prompt, "contentName": audio_content,
                            "content": msg["data"],
                        }})
            except WebSocketDisconnect:
                logger.info("STT: client disconnected")
                active = False
            except Exception as e:
                logger.error(f"STT send_audio error: {e}")
                active = False

        # Nova Sonic → Browser (transcript text only, ignore audio)
        async def recv_text():
            nonlocal active
            role = None
            try:
                while active:
                    output = await stream.await_output()
                    result = await output[1].receive()
                    if not (result.value and result.value.bytes_):
                        continue
                    data = json.loads(result.value.bytes_.decode("utf-8"))
                    event = data.get("event", {})

                    if "contentStart" in event:
                        role = event["contentStart"].get("role")
                    elif "textOutput" in event:
                        text = event["textOutput"].get("content", "")
                        r = event["textOutput"].get("role") or role
                        if text and r == "USER":
                            # ASR transcription — send as partial
                            logger.info(f"[NOVA-STT] 🎤 transcript: {text!r}")
                            await ws.send_json({"type": "transcript", "text": text, "final": False})
                        # Ignore ASSISTANT text — we only want STT
                    elif "contentEnd" in event:
                        # USER content ended = speech segment done, mark final
                        if role == "USER":
                            await ws.send_json({"type": "transcript", "text": "", "final": True})
                    elif "completionEnd" in event or "sessionEnd" in event:
                        active = False
                        break
            except Exception as e:
                logger.error(f"STT recv error: {e}")
                active = False

        await asyncio.gather(send_audio(), recv_text())

        # Cleanup
        await _send(stream, {"contentEnd": {"promptName": prompt, "contentName": audio_content}})
        await _send(stream, {"sessionEnd": {}})
        await stream.input_stream.close()

    except WebSocketDisconnect:
        logger.info("STT: WebSocket disconnected")
    except Exception as e:
        logger.error(f"STT error: {e}", exc_info=True)
    except BaseException as e:
        logger.error(f"STT base error: {e}", exc_info=True)


# --- TTS endpoint: send text, receive audio ---

@app.websocket("/tts")
async def tts_endpoint(ws: WebSocket):
    if not await _authorized_ws(ws):
        return
    await ws.accept()
    logger.info("[NOVA-TTS] ▶ client connected (text→speech synthesis)")
    client = _make_client()

    try:
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)
            if msg.get("type") != "speak":
                continue

            text = msg.get("text", "").strip()
            voice = msg.get("voice", "matthew")
            if not text:
                continue
            logger.info(f"[NOVA-TTS] 🔊 synthesize voice={voice} chars={len(text)}: {text[:60]!r}")

            prompt = str(uuid.uuid4())
            text_content = str(uuid.uuid4())

            stream = await client.invoke_model_with_bidirectional_stream(
                InvokeModelWithBidirectionalStreamOperationInput(model_id=MODEL_ID)
            )

            # Session + prompt start
            await _send(stream, {"sessionStart": {"inferenceConfiguration": {"maxTokens": 1024, "topP": 0.9, "temperature": 0.7}}})
            await _send(stream, {"promptStart": {
                "promptName": prompt,
                "textOutputConfiguration": {"mediaType": "text/plain"},
                "audioOutputConfiguration": {
                    "mediaType": "audio/lpcm", "sampleRateHertz": 24000,
                    "sampleSizeBits": 16, "channelCount": 1, "voiceId": voice,
                    "encoding": "base64", "audioType": "SPEECH",
                },
            }})

            # System prompt
            sys_content = str(uuid.uuid4())
            await _send(stream, {"contentStart": {
                "promptName": prompt, "contentName": sys_content,
                "type": "TEXT", "interactive": False, "role": "SYSTEM",
                "textInputConfiguration": {"mediaType": "text/plain"},
            }})
            await _send(stream, {"textInput": {
                "promptName": prompt, "contentName": sys_content,
                "content": "Read the following text aloud naturally. Do not add or change anything.",
            }})
            await _send(stream, {"contentEnd": {"promptName": prompt, "contentName": sys_content}})

            # User text to speak
            await _send(stream, {"contentStart": {
                "promptName": prompt, "contentName": text_content,
                "type": "TEXT", "interactive": True, "role": "USER",
                "textInputConfiguration": {"mediaType": "text/plain"},
            }})
            await _send(stream, {"textInput": {
                "promptName": prompt, "contentName": text_content,
                "content": text,
            }})
            await _send(stream, {"contentEnd": {"promptName": prompt, "contentName": text_content}})

            # Receive audio output
            done = False
            while not done:
                try:
                    output = await asyncio.wait_for(stream.await_output(), timeout=30)
                    result = await output[1].receive()
                    if not (result.value and result.value.bytes_):
                        continue
                    data = json.loads(result.value.bytes_.decode("utf-8"))
                    event = data.get("event", {})

                    if "audioOutput" in event:
                        audio_b64 = event["audioOutput"].get("content", "")
                        if audio_b64:
                            await ws.send_json({"type": "audio", "data": audio_b64})
                    elif "completionEnd" in event or "sessionEnd" in event:
                        done = True
                    elif "contentEnd" in event:
                        # Check if this is the end of audio content
                        pass
                except asyncio.TimeoutError:
                    done = True

            await ws.send_json({"type": "done"})

            # Cleanup stream
            try:
                await _send(stream, {"sessionEnd": {}})
                await stream.input_stream.close()
            except Exception:
                pass

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"TTS error: {e}")



@app.get("/stt/test")
async def stt_test_page():
    return FileResponse(os.path.join(os.path.dirname(__file__), "test_stt.html"), media_type="text/html")

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("NOVA_SONIC_PORT", "8505"))
    uvicorn.run(app, host="0.0.0.0", port=port)
