# API and interface reference

This document lists the orchestrator's HTTP endpoints, the environment variables that configure the
services, and the `vton_engines` extension contract. It complements [architecture.md](architecture.md)
and [configuration.md](configuration.md).

All endpoints are served by the orchestrator behind CloudFront under the `/api/*` path (the edge
strips the `/api` prefix, so the service sees the paths below). When authentication is enabled, every
path except `/health` and the public single-use try-on share endpoint `/tryon-share` requires a
Cognito bearer token (WebSocket-style calls use a `?token=` query parameter — see
[security.md](security.md)). `/tryon-share` carries no bearer token; it is guarded instead by a
single-use, time-limited token in its query string, so a shopper can open their try-on gallery from a
scanned QR code on any device.

## Conversation

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/chat` | Non-streaming chat turn. Body: `{ message, session_id, customer_id?, mode?, vton_* }`. Returns the assistant reply, any tool results (products, try-on), and a `cost` object. |
| POST | `/chat/stream` | Streaming chat turn (Server-Sent Events). Same body as `/chat`; emits incremental text, tool events, and a final `cost`. This is the path the web UI uses. |
| POST | `/invoke` | Lower-level single-turn agent invocation (LangGraph). |
| POST | `/invoke/stream` | Streaming variant of `/invoke`. |

The chat body accepts VTON control parameters that are passed through to the engine when a try-on is
triggered: `vton_engine`, `vton_steps`, `vton_cfg` (or `vton_cfg_scale`), and `vton_seed`.

### Example: `POST /chat`

Request:

```json
{ "message": "Show me a casual shirt under $50", "session_id": "s-123", "customer_id": "c-456" }
```

Response (trimmed):

```json
{
  "reply": "Here are a few casual shirts under $50 ...",
  "products": [ /* ... */ ],
  "cost": {
    "llm": { "model": "bedrock-claude", "label": "Claude Sonnet 4.6", "usd": 0.0021 },
    "infra": { "usd": 0.0004 },
    "total_usd": 0.0025
  }
}
```

`POST /chat/stream` takes the same body but returns Server-Sent Events (incremental text, tool events,
and a final `cost` event) instead of a single JSON response.

## Catalog

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/search_products` | Search the catalog (query, filters). |
| GET | `/get_product_details` | Product detail by `product_id`. |
| GET | `/recommend_size` | Size recommendation from a body photo. |

## Cart and checkout

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/get_cart` | Current cart for a customer. |
| POST | `/add_to_cart` · `/remove_from_cart` | Modify the cart. |
| POST | `/checkout` | Place an order (demo). |
| GET | `/get_order_history` | Past orders. |

## Virtual try-on

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/upload_tryon_photo` | Upload the customer photo used for try-on. |
| GET | `/check_photo` | Whether a usable photo exists. |
| POST | `/virtual_try_on` | Generate a try-on. Body: `{ customer_id, product_id, engine?, vton_steps?, vton_cfg_scale?, vton_seed? }`. Returns `{ result_url, engine, inference_sec, cost }` or `{ error: "content_review", message }`. |
| GET | `/get_tryon_room` · POST `/add_to_tryon_room` · `/remove_from_tryon_room` | Try-on room (shortlist) management. |
| GET | `/get_tryon_results` | Previously generated results for a customer. |
| POST | `/generate_tryon_qr` | Generate the post-checkout QR. Mints a single-use, 24h-TTL share token in the `share-tokens` table and returns `{ qr_code_base64, share_url, image_count }`; the QR encodes `share_url` (a `/tryon-share` link). Returns empty when the customer has no try-on images or `PUBLIC_BASE_URL` is unset. |
| GET | `/tryon-share` | **Public** single-use gallery for a scanned QR. Validates `?token=` (marking it used atomically on first access), then serves the customer's try-on images via short-lived (15-min) presigned S3 URLs as a self-contained HTML page. A second access returns "already used" (HTTP 410). |

## Customer, session, and misc

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/register_customer` · `/update_customer_profile` | Customer profile. |
| GET | `/get_customer_profile` | Profile by id. |
| GET | `/get_booth_queue` | Booth-mode queue state. |
| GET | `/load_chat_history` · POST `/save_chat_message` | Persisted chat history (DynamoDB). |
| POST | `/end_session` | Session-end hook. Body: `{ customer_id, session_id?, messages }`. For signed-in customers, summarizes the session into long-term memory (S3 Vectors). Also fires automatically from `/chat` on a `[CHECKOUT_COMPLETE]`/`[LOGOUT]` marker. Returns `{ stored, summary }`. |
| GET | `/get_session_cost` | Session cost aggregate. |
| POST | `/token` | Exchange/refresh helper for the UI. |
| GET | `/health` | Health check (never authenticated). |
| GET | `/avatar` · `/avatars` | HeyGen avatar session/listing (when the avatar module is enabled). |

Voice and avatar streaming use WebSockets (not on the orchestrator): `/stt`, `/tts` (voice-nova),
`/whisper` (whisper), and `/ws` (avatar), routed by CloudFront to their services.

## Orchestrator environment variables

| Variable | Purpose |
|----------|---------|
| `ENV`, `AWS_REGION`, `ACCOUNT_ID` | Resource naming and region |
| `PRODUCT_IMAGES_BUCKET` | S3 bucket for product images |
| `LITELLM_URL`, `LITELLM_API_KEY` | Gateway endpoint and key |
| `CHAT_MODEL` | Default chat model (gateway name, e.g. `bedrock-claude`) |
| `ROUTER_MODEL` | Intent-router model (e.g. `bedrock-haiku`) |
| `FASHN_VTON_URL`, `QWEN_VTON_URL` | In-cluster try-on engine endpoints |
| `VTON_SAFETY_ENABLED` | Toggle content verification (default on) |
| `VTON_SAFETY_MODEL_ID` | Verifier model (default `us.amazon.nova-lite-v1:0`) |
| `VTON_SAFETY_REGION` | Region for the verifier |
| `COGNITO_USER_POOL_ID`, `COGNITO_APP_CLIENT_ID`, `COGNITO_REGION` | Authentication (auth is a no-op if the pool ID is unset) |
| `PUBLIC_BASE_URL` | Public base URL (custom domain or CloudFront) used to build shareable links such as the try-on QR gallery; empty disables the QR |

## Extending try-on: the `vton_engines` contract

Try-on prompt engineering lives in the shared package `components/shared/vton_engines/` (synced into
each consumer's build context by `scripts/sync-vton-engines.sh` — edit only the canonical copy).

- `CATEGORY_CONFIG: dict[category] -> (garment, body_region, cfg)` maps a product category to its
  garment description, body region, and default CFG scale (ported verbatim from the tuned v1 set).
- `build_request(engine, category, steps=None, cfg_override=None, seed=None) -> dict` returns the
  fields a serving endpoint expects: `prompt`, `negative_prompt`, `true_cfg_scale`,
  `num_inference_steps`, `seed`, and the engine-specific `category`/`body_region`.

To add an engine, register it in the package and reference it from the gateway/engine registry in
`storeai.config.json` (`engines.vton.engines`) — no changes to the orchestrator or the try-on app are
required.
