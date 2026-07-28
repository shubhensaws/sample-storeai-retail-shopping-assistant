# Capacity Planning: Qwen3-8B (Neuron) + Whisper large-v3 (GPU)

## Summary

| Workload | Instance type | Accelerator | vCPU | RAM | Accel memory | On-Demand $/hr | Capacity Blocks eligible? |
|---|---|---|---|---|---|---|---|
| **Qwen3-8B** (vLLM on Neuron) | `trn1.32xlarge` | 16 × Trainium | 128 | 512 GiB | 512 GB HBM | **$21.50** | **Yes** |
| **Whisper large-v3** (GPU) | `g6.xlarge` | 1 × NVIDIA L4 | 4 | 16 GiB | 24 GB GDDR6 | **$0.80** | **No** |
| **VTON Qwen-Image-Edit** (Neuron) | `trn1.32xlarge` | 16 × Trainium | 128 | 512 GiB | 512 GB HBM | **$21.50** | **Yes** |

> Prices are us-east-1 On-Demand as of April 2026. Capacity Block pricing
> is typically 30–60% lower than On-Demand for equivalent duration.

---

## 1. Qwen3-8B on Neuron — Capacity Block reservation

### Why Capacity Blocks

The current `llm-serving.yaml` already uses `storeai/capacity-type: capacity-block`
as a node selector. Capacity Blocks reserve the `trn1.32xlarge` instance so it is
available for the reserved window — critical for demos and events (e.g., AWS
Summit booth) where on-demand availability is not assured.

### Instance requirements

From the existing K8s manifest:

- **Instance**: `trn1.32xlarge` (16 Neuron cores, 512 GB HBM)
- **Neuron cores requested**: 16 (full instance)
- **vLLM config**: TP=16, max-model-len=32768, batch-size=1
- **Storage**: model weights (~16 GB) + Neuron compiled cache (~8 GB) on NVMe
  local storage (1.9 TB available on trn1.32xlarge)
- **Replicas**: 1 (single inference pod; scale to 2 for HA)

### How to reserve

```bash
# 1. Check available Capacity Block offerings
aws ec2 describe-capacity-block-offerings \
  --instance-type trn1.32xlarge \
  --instance-count 1 \
  --capacity-duration-hours 168 \
  --region us-east-1

# 2. Purchase a Capacity Block (7-day example)
aws ec2 purchase-capacity-block \
  --capacity-block-offering-id <offering-id-from-step-1> \
  --instance-platform Linux/UNIX \
  --region us-east-1

# 3. The reservation returns a capacity-reservation-id.
#    Use it in the EKS node group / Karpenter provisioner.
```

### Karpenter provisioner for Capacity Blocks

```yaml
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: neuron-capacity-block
spec:
  template:
    spec:
      nodeClassRef:
        group: eks.amazonaws.com
        kind: NodeClass
        name: default
      requirements:
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["capacity-block"]
        - key: node.kubernetes.io/instance-type
          operator: In
          values: ["trn1.32xlarge"]
      taints:
        - key: storeai/accelerator
          value: "true"
          effect: NoSchedule
  limits:
    cpu: "128"
    memory: "512Gi"
```

### Duration guidance

| Scenario | Recommended duration | Estimated cost |
|---|---|---|
| Summit booth (3-day event + 1 day setup) | 4 days (96 hrs) | ~$1,200–1,400 |
| Dev/test sprint | 7 days (168 hrs) | ~$2,100–2,500 |
| Sustained demo environment | 28 days | ~$8,400–10,000 |

Reserve up to 8 weeks in advance. Extend up to 56 days before expiry.

---

## 2. VTON Qwen-Image-Edit on Neuron — same instance family

The VTON model also runs on `trn1.32xlarge`. For cost efficiency, **co-locate
Qwen3-8B and VTON on the same instance** if inference is sequential (booth mode
processes one customer at a time). The K8s manifests already use the same
`storeai/capacity-type: capacity-block` selector.

If you need parallel LLM + VTON, reserve **2 × trn1.32xlarge**.

---

## 3. Whisper large-v3 on GPU — On-Demand (no Capacity Blocks)

### Why no Capacity Blocks

**EC2 Capacity Blocks do not support G-series instances** (g6, g5, g4dn).
Supported families are: P6e-GB200, P6-B300, P6-B200, P5en, P5e, P5, P4d,
P4de, Trn2, Trn1.

### Alternatives for reserved Whisper capacity

| Option | Instance | Cost | Pros | Cons |
|---|---|---|---|---|
| **On-Demand g6.xlarge** | g6.xlarge (1× L4, 24 GB) | $0.80/hr | Simple, current setup | No reservation |
| **Reserved Instance (1yr)** | g6.xlarge | ~$0.51/hr | 36% savings, reserved | 1-year commitment |
| **Savings Plan (1yr)** | g6.xlarge | ~$0.51/hr | Flexible across instance sizes | 1-year commitment |
| **On-Demand Capacity Reservation** | g6.xlarge | $0.80/hr (pay whether used or not) | Reserved capacity, no commitment term | Full price even when idle |
| **Whisper on Neuron** | inf2.xlarge (1 Neuron core) | $0.76/hr | Capacity Blocks eligible via inf2; lower cost | Requires Neuron-compiled Whisper (already in repo: `whisper-neuron/`) |
| **Bedrock Nova Sonic STT** | Managed | Per-request | No infra to manage | Pricing varies; less control |

### Recommended path

**For events / demos**: use **On-Demand Capacity Reservation** on `g6.xlarge`.
This reserves the instance but doesn't require a 1-year commitment:

```bash
aws ec2 create-capacity-reservation \
  --instance-type g6.xlarge \
  --instance-platform Linux/UNIX \
  --availability-zone us-east-1a \
  --instance-count 1 \
  --instance-match-criteria targeted \
  --end-date-type limited \
  --end-date 2026-06-01T00:00:00Z
```

Then target it in Karpenter:

```yaml
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: gpu-whisper
spec:
  template:
    spec:
      nodeClassRef:
        group: eks.amazonaws.com
        kind: NodeClass
        name: default
      requirements:
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["on-demand"]
        - key: node.kubernetes.io/instance-type
          operator: In
          values: ["g6.xlarge"]
  limits:
    cpu: "4"
    memory: "16Gi"
```

**For sustained production**: switch to the **Neuron-compiled Whisper** on
`inf2.xlarge` (already in the repo at `whisper-neuron/`). Inf2 is eligible
for Capacity Blocks, giving you the same reservation as the LLM.

---

## 4. Full reservation checklist

```
[ ] 1. Decide event dates / duration
[ ] 2. Reserve trn1.32xlarge Capacity Block (Qwen3 + VTON)
       - 1 instance if sequential, 2 if parallel
[ ] 3. Reserve g6.xlarge On-Demand Capacity Reservation (Whisper)
       - Or switch to inf2.xlarge + Capacity Block for Whisper-Neuron
[ ] 4. Update Karpenter NodePool manifests with reservation IDs
[ ] 5. Verify EKS node group picks up the reserved instances
[ ] 6. Deploy K8s workloads (llm-serving, whisper-serving, vton-serving)
[ ] 7. Smoke-test: curl the /health endpoints
```
