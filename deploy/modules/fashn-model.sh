#!/usr/bin/env bash
# fashn-model / vton-fashn (L1) — build FASHN VTON v1.5 GPU image (amd64) and
# deploy to the GPU NodePool. Service = storeai-fashn-vton:8081 (client contract).
set -euo pipefail

NS="default"
_r() { python3 "${LIB_DIR}/resolve.py" --config "$1" get "$2" 2>/dev/null; }

mod_deploy() {
  local config="$1" region env account repo tag ecr_uri src manifest
  region=$(_r "$config" global.region); region="${region:-us-east-2}"
  env=$(_r "$config" global.env); env="${env:-dev}"
  account=$(_r "$config" global.accountId)
  if [ -z "$account" ] || [ "$account" = "auto" ] || [ "$account" = "None" ]; then
    account=$(aws sts get-caller-identity --query Account --output text)
  fi
  src="${PROJECT_DIR}/components/vton-fashn"
  repo="storeai-${env}-vton-fashn"
  tag="$(cd "$PROJECT_DIR" && git rev-parse --short HEAD 2>/dev/null || echo dev)-$(date +%H%M%S)"
  ecr_uri="${account}.dkr.ecr.${region}.amazonaws.com/${repo}"

  echo "  building FASHN VTON v1.5 image (amd64/GPU) → ${ecr_uri}:${tag}"
  aws ecr get-login-password --region "$region" | podman login --username AWS --password-stdin "${account}.dkr.ecr.${region}.amazonaws.com" >/dev/null
  podman build --platform linux/amd64 -t "${ecr_uri}:${tag}" -t "${ecr_uri}:latest" "$src"
  podman push "${ecr_uri}:${tag}"; podman push "${ecr_uri}:latest"

  export REGION="$region" ENV="$env" ACCOUNT_ID="$account" IMAGE_TAG="$tag"
  manifest="$(mktemp -t fashn.XXXXXX.yaml)"
  envsubst < "${PROJECT_DIR}/k8s/vton-fashn-serving.yaml" > "$manifest"
  kubectl apply -f "$manifest"; rm -f "$manifest"

  echo "  waiting for FASHN rollout (GPU node provision + ~2GB weight download + model load — up to ~20min)..."
  kubectl rollout status deployment/storeai-fashn-vton -n "$NS" --timeout=1200s
  echo "  FASHN VTON service: http://storeai-fashn-vton.${NS}.svc.cluster.local:8081 (/infer)"
}

mod_teardown() { kubectl delete deployment,service storeai-fashn-vton -n "$NS" --ignore-not-found >/dev/null 2>&1 || true; }
mod_verify() { kubectl get pods -n "$NS" -l app=storeai-fashn-vton 2>/dev/null || true; }
