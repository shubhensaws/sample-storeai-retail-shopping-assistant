# Design decisions

This document records the significant architectural decisions behind StoreAI, and the assumptions the
design depends on. It is a curated, external-facing version of the project's internal decision log.
Each entry states the decision, why it was made, and what it implies.

> **Note:** This is a curated set — only the externally relevant decisions are published, so the
> D-numbers are stable identifiers rather than a continuous sequence.

## Assumptions

The design assumes the following. Where an assumption is also a deployment input, it is configurable
(see [configuration.md](configuration.md)).

- **You bring an AWS account.** StoreAI uses Anthropic Claude and Amazon Nova models through Amazon
  Bedrock.
- **You provide one thing: a Terraform state S3 bucket.** Everything else is created by Terraform.
- **Accelerators are opt-in and pre-provisioned.** Self-hosting the LLM or the Qwen Image-Edit model
  requires a Trainium capacity block that you reserve in advance and pass in by ID.
- **Compiled model artifacts are optional.** If you supply an S3 path to pre-compiled artifacts they
  are reused; otherwise the deployer compiles them on first deploy.
- **The default region is `us-east-2`** and the default environment is `dev`; `prod` is supported.

## Infrastructure and deployment

### D-001 — Terraform and EKS Auto Mode
Use Terraform as the single infrastructure-as-code tool and EKS Auto Mode for the cluster foundation.
**Why:** Auto Mode removes the need to manage the load-balancer controller, node scaling, and add-ons.
**Implication:** CloudFormation was retired; all resources are Terraform modules.

### D-002 — Modular repository layout
Restructure to a `deploy/ components/ infra/terraform/ k8s/ docs/` layout suitable for direct reuse.
**Why:** The project is shared as a reference architecture.

### D-006 / D-022 — Incremental delivery, verify before building, document every decision
Build and test one module at a time on real AWS; verify feasibility against authoritative sources
before implementing; record every decision. **Why:** Reduces compounded failure and preserves context.

### D-013 — Terraform owns everything except the state bucket
The only infrastructure a user supplies is the Terraform state S3 bucket. Terraform creates all other
resources, including the compiled-model bucket and SSM parameters. **Implication:** Preflight validates
the state bucket but never creates or deletes it.

### D-025 — Single-command teardown is a first-class requirement
`storeai down --all` removes every provisioned resource in reverse dependency order; the state bucket
is preserved. **Why:** Symmetric with one-command deploy; enables clean-room validation.

### D-041 — Two-pass Terraform apply
CloudFront's VPC origin needs a real ALB, which the Kubernetes ingress creates. The deployer applies
all modules except the CDN first, then re-applies the CDN (and Lambdas) once the ingress ALB exists.
**Why:** Resolves a dependency cycle without placeholder resources.

## AI gateway and models

### D-010 — All model calls go through a LiteLLM gateway
Every LLM chat and image-generation call routes through a single LiteLLM gateway. **Why:** One place
to add or remove models by configuration, and one place to meter cost. **Implication:** Backends are
registered in gateway config; nothing calls a model backend directly.

### D-011 / D-015 — Pluggable, config-driven engine registry
Try-on and LLM engines are a pluggable registry; UI control parameters are model- and
platform-agnostic. **Why:** New models must be addable without code changes. **Implication:** Available
models come from config; the UI reflects them automatically.

### D-018 — Three-layer component model
Separate generic model servers (L1) from application/domain logic that owns prompts (L2) from the
gateway (L3). **Why:** A model must be deployable and queryable on its own, and prompts belong to the
product, not the model.

### D-009 — Try-on requires a self-hosted engine (no managed fallback)
Virtual try-on runs only on a self-hosted engine — Qwen Image-Edit (default when available) or
FASHN. **Why:** no managed/zero-infrastructure Bedrock try-on engine is available. **Implication:**
try-on needs a GPU (FASHN) or Trainium (Qwen) engine deployed; there is no zero-infrastructure
try-on fallback.

### D-021 — Nova Sonic is the one gateway exception
LLM chat and try-on route through the gateway. Amazon Nova Sonic — which StoreAI uses for
speech-to-text and text-to-speech — calls Bedrock directly over its bidirectional streaming API,
because the gateway cannot proxy that stream. **Implication:** Nova Sonic cost is metered in the
voice layer, not at the gateway.

### D-012 — Two speech-to-text options
Keep Nova Sonic — used for speech-to-text and text-to-speech, each over Bedrock's bidirectional
streaming API — and additionally offer Whisper as a separate speech-to-text module.

## Networking

### D-019 — Private-by-default, CloudFront-only ingress
All compute runs in private subnets. CloudFront is the only public ingress and fronts an internal ALB
through VPC origins. Bedrock and other AWS services are reached over interface and gateway endpoints;
a single NAT gateway handles external egress. **Why:** Security-focused posture; avoids public or
dedicated load balancers on internal services.

### D-020 — The try-on app stays a Lambda
The `vton` application remains an MCP-tool Lambda and reaches the gateway over the internal ALB.
**Why:** Minimal change; preserves the MCP-tool pattern.

### D-024 — Backend region can differ from provider region
The Terraform state bucket lives in `us-east-1` while resources deploy to `us-east-2`. These are
configured independently.

## Cost transparency

### D-014 / D-026 — Per-call and session cost transparency
The gateway computes per-call cost from a config-driven price table and returns it per response. The
application shows the cost of each interaction inline (with the model or engine labeled) and a running
session total broken down by category — chat, try-on, and speech-to-text — plus a separate, clearly
labeled infrastructure estimate. Nova Sonic reports its own cost into the same aggregator.
**Why:** Cost visibility per interaction and per capability is a core goal.

## Compute and accelerators

### D-039 — GPU time-slicing does not work on EKS Auto Mode
Empirically tested on a live cluster: a foreign device plugin's time-sliced GPU allocations lose the
NVIDIA driver injection and cannot run CUDA. **Implication:** One GPU pod per single-GPU instance;
scale-to-zero is the cost lever, not sharing.

### D-040 — Hybrid cluster: Auto Mode plus managed node groups
Run general services on Auto Mode (Graviton) and accelerator workloads (NVIDIA GPU and Trainium) on
managed node groups. **Why:** Auto Mode's managed accelerator device plugins had gaps (GPU
time-slicing incompatibility, Neuron allocation timeouts); managed node groups give control of the
driver and device-plugin stack. **Note:** Dynamic Resource Allocation (DRA) is not supported on
Karpenter or EKS Auto Mode, so topology-aware Neuron scheduling also requires managed node groups.

### D-005 — Capacity blocks pre-provisioned; compilation optional
Trainium capacity blocks are reserved by the user and supplied by ID. Model compilation runs only when
a pre-compiled artifact is not supplied, and results are cached to S3 so fresh nodes skip recompilation.

## Security and authentication

### D-042 — App-level Cognito JWT is the real authentication boundary
Authentication verifies a Cognito-issued JWT against the pool's public keys (stateless — no passwords
or sessions stored by the app). It is environment-gated, so internal in-cluster calls without a token
still work. A CloudFront Function provides a cheap edge token-presence filter, but signature
verification happens in the application. **Why:** ALB `authenticate-cognito` is a browser redirect flow
and cannot validate a programmatic bearer token. A single token is reused everywhere (single sign-on).

### D-004 — HeyGen avatar is optional and off by default
The avatar integrates HeyGen. The API key is an optional prerequisite; the module deploys only when a
key is present. The key is stored as a secret and never committed.

## Documentation

### D-008 — Process docs and product docs are separate
Internal planning artifacts and the working decision log are kept separate from the product
documentation and are not shipped with the repository. This document is the curated, published
version of that decision log; the shippable product documentation lives in `docs/`.

## Long-term memory

### D-043 — Long-term customer memory uses Amazon S3 Vectors, not OpenSearch Serverless
Signed-in customers get cross-session memory: session summaries are embedded (Amazon Titan Text
Embeddings v2, 1024-dim) and stored in **Amazon S3 Vectors** for semantic recall, with a DynamoDB
record as the durable system of record and recency fallback. Memory is written on session end
(a `[CHECKOUT_COMPLETE]`/`[LOGOUT]` marker or an explicit `/end_session` call) via a Haiku
summarization, and read once per turn to personalize the prompt. **Why S3 Vectors over OpenSearch
Serverless:** the workload is sparse (one read per turn, one write per session) and small, which is
S3 Vectors' cost sweet spot — pay-per-use with no idle compute, versus an always-on OCU floor
(~$174–350/month) for OpenSearch Serverless. The trade-off is higher query latency (~100–400 ms
vs. single-digit ms), which is negligible in front of a multi-second LLM turn, and the loss of
hybrid/lexical search and advanced filtering, none of which this per-customer semantic recall needs.
**IaC note:** the repo pins the AWS provider at `~> 5.0`, which predates the native
`aws_s3vectors_*` resources (provider 6.x), so the vector bucket and index are provisioned via
`null_resource` + the `aws s3vectors` CLI (idempotent create + `when=destroy` cleanup) in the
`memory-search` module — Terraform-managed and cleanly destroyable, with a future migration to the
declarative `aws_s3vectors_*` / `awscc_s3vectors_*` resources once the provider is bumped.

### D-044 — Try-on QR sharing uses a single-use, expiring token
The post-checkout QR lets a shopper open their try-on photos on a phone that has no session. A raw S3
presigned URL was rejected because a presigned URL addresses a single object (not the multi-image
result set) and expires on a timer rather than on first access. A `/tryon_gallery?customer_id=…` link
was also rejected — it is auth-gated (CloudFront edge + orchestrator middleware), so an
unauthenticated phone gets 401, and a raw customer id is a guessable, non-expiring reference.
**Decision:** `/generate_tryon_qr` mints an opaque token into the `share-tokens` table
(`{ token, customer_id, s3_keys, used, ttl }`, 24h TTL) and the QR encodes `/api/tryon-share?token=…`.
The public `/tryon-share` endpoint marks the token used atomically (DynamoDB conditional update) on
first access, then serves the images as 15-minute presigned S3 URLs in a self-contained HTML page.
**Why:** Genuine single-use (enforced by the token, not the presigned URL), works on any device with
no auth, and auto-cleans via TTL. **Implication:** `/tryon-share` is exempt at both the orchestrator
auth middleware and the CloudFront edge gate; the images themselves stay private (short-lived
presigned URLs, not public objects). Ported from the V1 (`main`) design.
