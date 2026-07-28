# Security

This document summarizes the security measures built into StoreAI and the settings you should review
before running it beyond a local demo. StoreAI is a reference architecture — treat the demo defaults
as a starting point, not a production security baseline.

## Authentication

StoreAI uses a two-layer authentication model built on Amazon Cognito.

- **Edge filter (CloudFront Function).** An inline CloudFront Function — the `strip_api` function
  defined in `infra/terraform/modules/cdn/main.tf` — rejects `/api/*` requests that arrive without an
  `Authorization` header (except `/api/health` and the public single-use `/api/tryon-share`). It is a
  cheap first filter; it does not verify
  signatures.
- **Application JWT verification (the real boundary).** The orchestrator, voice, and Whisper services
  verify the Cognito-issued JWT against the user pool's public keys (RS256 via JWKS), checking the
  audience (app client) and issuer (user pool). Verification is **stateless** — the app stores no
  passwords or sessions; Cognito owns login.
- **Environment-gated.** Verification is a no-op unless `COGNITO_USER_POOL_ID` is set, so internal
  in-cluster calls without a token continue to work. Enable it by setting the Cognito environment
  variables (done automatically when the `data-plane` module provisions the pool).
- **WebSocket auth.** Browsers cannot set custom headers on WebSocket connections, so the voice and
  avatar sockets (`/stt`, `/tts`, `/whisper`, `/ws`) pass the token as a `?token=` query parameter,
  which the server verifies the same way.
- **Single sign-on.** One token is reused across REST and WebSocket calls — no second login.
- **Public single-use share.** The post-checkout try-on QR opens `/tryon-share`, the one deliberately
  public endpoint. A scanned phone has no Cognito token, so instead of a bearer token it is guarded by
  an opaque, single-use, 24h-TTL token (in the `share-tokens` table) that is consumed on first access;
  it then serves the try-on images only as short-lived (15-minute) presigned S3 URLs. See
  [design-decisions.md](design-decisions.md) (D-044).

See [design-decisions.md](design-decisions.md) (D-042) for why ALB `authenticate-cognito` was not
used for the API.

## Network isolation

- All compute runs in a private VPC across two Availability Zones, on **private subnets**.
- **CloudFront is the only public ingress.** It fronts an **internal** ALB through VPC origins; the
  ALB is not internet-facing.
- AWS service access is private: **gateway endpoints** for S3 and DynamoDB, and **interface
  endpoints** for Bedrock, ECR, STS, CloudWatch Logs, Secrets Manager, and SSM.
- A single NAT gateway provides outbound egress for external dependencies only.

## Authorization (least privilege)

- Workloads use **EKS Pod Identity** roles scoped to the specific resources they need — for example,
  the orchestrator role is limited to the project's DynamoDB tables and S3 buckets.
- The load-balancer controller policy is scoped to the tags that EKS manages.

## Data protection

- **Customer photos and try-on results** are stored in S3 and served only over the authenticated
  `/tryon-images/*` and `/tryon-results/*` paths (token required). Product catalog images are public
  under `/images/*`.
- Image URLs handed to the browser are **presigned with a short (1-hour) expiry**.
- Content served through `/tryon-*` uses a CloudFront cache policy that does not cache across token
  presence, so an authenticated response cannot leak to an unauthenticated viewer.
- **Long-term memory** stores per-customer behavioral summaries (preferences, sizes, past purchases)
  in Amazon S3 Vectors and DynamoDB, keyed and query-filtered by `customer_id` so one customer's
  memory is never returned for another. Only **signed-in** customers have memory; guests do not.
  Memory is written from a fast-model session summary — no raw transcript is retained. The vector
  bucket and `memory` table are Terraform-managed, so `down --all` deletes all stored memory. For a
  non-demo deployment, review a retention/TTL policy and your privacy obligations before enabling it
  for real users.

## Content safety

- Generated try-on images are checked with Amazon Nova Lite before being returned. If the primary
  engine's output is flagged, StoreAI falls back to a second engine and re-verifies; if no safe image
  can be produced, it returns a generic content-review message rather than the image.
- The check is modular (`components/orchestrator/app/vton_verify.py`), toggleable with
  `VTON_SAFETY_ENABLED` (default on), and the verifier model is configurable with
  `VTON_SAFETY_MODEL_ID`.

> **Fails open — production consideration.** If the verifier model is unreachable, the generated image
> is returned **unchecked** rather than blocking a legitimate try-on. Decide whether this
> availability-over-safety trade-off is acceptable for your deployment, or change the behavior to fail
> closed.

## Secrets handling

- The LiteLLM gateway master key is stored in AWS SSM Parameter Store, not in code or manifests.
- The optional HeyGen API key is supplied as a configuration secret and is never committed.
- No credentials are hardcoded in application code.

## Review before non-demo use

The demo defaults favor a smooth first run. Change these for anything beyond a local demo:

| Setting | Demo default | Recommendation |
|---------|--------------|----------------|
| Cognito sign-in user | No password stored in config — a real `adminEmail` gets an emailed invite (user sets their own password); blank creates `admin@storeai.local` with no password (operator sets one via CLI/console) | Prefer a real `adminEmail`; for production, back the invitation email with Amazon SES (`email_sending_account = "DEVELOPER"`) |
| CORS | `allow_origins=["*"]` on the orchestrator | Restrict to your store's domain |
| Conversation state | In-memory checkpointer (`MemorySaver`) — graph state is not persisted across restarts (chat **history** is persisted separately to DynamoDB) | Wire the DynamoDB checkpointer if you need durable in-flight conversation state |
| Authentication | Enabled only when `COGNITO_USER_POOL_ID` is set | Keep it enabled in any shared environment |
| Edge protection | No WAF or rate limiting | Add AWS WAF and request rate limiting in front of CloudFront (production hardening; not enabled in the demo) |
| Model-server containers | The self-hosted model servers (Neuron LLM, Qwen Image-Edit, Whisper, FASHN) run as **root** with a **writable root filesystem** — required for CUDA/Neuron JIT caches and model-cache writes | The app services (orchestrator, voice, avatar) already run non-root with a read-only root filesystem; apply the same hardening to model servers if you adapt them for production |
| Network policies | No per-pod Kubernetes `NetworkPolicy` (all workloads share the `default` namespace) | Add NetworkPolicies to restrict pod-to-pod traffic in a shared/multi-tenant cluster |
| Encryption at rest | S3 and DynamoDB use SSE-S3 (AWS-managed keys) | Use a customer-managed KMS key (CMK) if you need key rotation control, access policies, or audit of key usage |
| Audit & logging | No S3 server access logging, DynamoDB point-in-time recovery, VPC flow logs, or ECR scan-on-push in the demo | Enable these for production observability, forensics, and compliance |

## Reporting a vulnerability

Do not open a public issue for security problems. Follow the process in
[CONTRIBUTING.md](../CONTRIBUTING.md#security-issue-notifications).
