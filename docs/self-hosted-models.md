# Self-hosted models

StoreAI can run its large language model and its virtual try-on model on AWS Trainium instead of
calling managed services. This is **optional** — by default the assistant uses Anthropic Claude on
Amazon Bedrock for chat, and virtual try-on uses the FASHN engine on GPU.

Self-hosting removes per-token and per-image inference charges in exchange for running dedicated
accelerator capacity.

## What you can self-host

| Model | Module | Accelerator | Replaces |
|-------|--------|-------------|----------|
| [Qwen3-8B](https://huggingface.co/Qwen/Qwen3-8B) (via vLLM) | `llm` | Trainium (`trn2`) | Bedrock Claude for chat |
| [Qwen Image-Edit](https://huggingface.co/Qwen/Qwen-Image-Edit) | `image-edit-model` | Trainium (`trn2`) | FASHN for virtual try-on |

Both are registered as backends in the LiteLLM gateway, so enabling them is a configuration change
(see [configuration.md](configuration.md)).

## Prerequisites

- A **Trainium capacity block reservation** (default instance type `trn2.48xlarge`). Reserve it in
  advance and supply its ID — see [`infra/capacity-blocks/request-capacity.md`](../infra/capacity-blocks/request-capacity.md).
- Amazon Bedrock is still used by other features (Nova Sonic voice, content-safety checks).

Capacity blocks are zonal and time-bounded: EC2 reclaims the nodes shortly before the reservation
ends, so plan a graceful scale-down. Supply the reservation ID in your **config**
(`prerequisites.capacityBlock.reservationId`); the deployer seeds it into an SSM parameter via
Terraform (created on deploy, destroyed on teardown). You can also rotate it out-of-band in SSM
without editing code.

Base weights are provisioned automatically. On deploy the model server reuses the Terraform-managed
S3 cache if present; otherwise it **downloads the model from HuggingFace** (verifying all safetensors
shards for completeness) and persists it to the S3 cache so later pods/nodes start fast. For faster
**authenticated** downloads set an optional token in `prerequisites.huggingface.token` — it becomes a
`hf-token` Kubernetes secret; if empty, the public (unauthenticated) download is used.

## How compilation works

Neuron models must be compiled ahead of inference. StoreAI handles this automatically:

- If you provide an S3 path to pre-compiled artifacts (`models.llmS3Path` / `models.vtonS3Path`), the
  deployer **reuses** them.
- If you do not, the deployer **compiles the model** into a Terraform-managed S3 cache bucket on first
  deploy, then serves it. Fresh nodes reuse the cached artifacts and skip recompilation.

Compilation takes roughly 30–45 minutes per model, so supplying pre-compiled artifacts makes
subsequent deployments much faster.

## Deploying a self-hosted model

Enable the module in your config and deploy it. The resolver brings up the cluster, capacity-block
node group, and gateway automatically:

```bash
# Self-hosted LLM on Trainium
./deploy/storeai up --module llm

# Self-hosted Qwen Image-Edit try-on on Trainium
./deploy/storeai up --module image-edit-model
```

To make self-hosted chat the default, set `engines.llm.default` to your backend (for example
`qwen3-neuron`). To prefer Qwen Image-Edit for try-on, enable it under `engines.vton.engines`;
with `default: "auto"` it is preferred whenever it is available.

## The image-edit model is a standalone service

The Qwen Image-Edit model is exposed as a **generic** image-and-prompt-to-image endpoint (`/infer`),
independent of the try-on application. You can deploy and query it on its own — the virtual try-on
prompt, garment mapping, and safety checks live in the `vton` application layer, not in the model (see
[design-decisions.md](design-decisions.md), D-018). The model service also ships a small
self-served HTML tester at `/` for uploading a person and garment image directly.

## Compute placement

Self-hosted models run on **managed node groups** bound to your capacity block, not on EKS Auto Mode.
Auto Mode could not reliably serve the Neuron device plugin, so accelerator workloads use managed node
groups with a Neuron device plugin and scheduler. See [design-decisions.md](design-decisions.md)
(D-040) for the details.

## Verifying

After deployment, confirm the model is serving through the gateway:

```bash
./deploy/storeai status
```

For chat, send a message in the UI and confirm the cost sidebar attributes it to your self-hosted
model rather than to Bedrock. For try-on, generate an image and confirm the reported engine is
`qwen_image_edit`.
