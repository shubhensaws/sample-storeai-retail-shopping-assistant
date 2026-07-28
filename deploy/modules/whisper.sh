#!/usr/bin/env bash
# whisper (L1) — faster-whisper large-v3 STT on GPU. Build amd64 image (model
# baked) → ECR storeai-dev-whisper, deploy to the GPU NodePool. WS /whisper:8765.
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
  src="${PROJECT_DIR}/components/whisper"
  repo="storeai-${env}-whisper"
  tag="$(cd "$PROJECT_DIR" && git rev-parse --short HEAD 2>/dev/null || echo dev)-$(date +%H%M%S)"
  ecr_uri="${account}.dkr.ecr.${region}.amazonaws.com/${repo}"

  echo "  building whisper image (amd64/GPU, large-v3 baked) → ${ecr_uri}:${tag}"
  aws ecr get-login-password --region "$region" | podman login --username AWS --password-stdin "${account}.dkr.ecr.${region}.amazonaws.com" >/dev/null
  podman build --platform linux/amd64 -t "${ecr_uri}:${tag}" -t "${ecr_uri}:latest" "$src"
  podman push "${ecr_uri}:${tag}"; podman push "${ecr_uri}:latest"

  local cog_pool cog_client
  cog_pool=$(terraform -chdir="${PROJECT_DIR}/infra/terraform" output -raw cognito_user_pool_id 2>/dev/null || true)
  cog_client=$(terraform -chdir="${PROJECT_DIR}/infra/terraform" output -raw cognito_client_id 2>/dev/null || true)
  export REGION="$region" ENV="$env" ACCOUNT_ID="$account" IMAGE_TAG="$tag" COGNITO_USER_POOL_ID="${cog_pool}" COGNITO_APP_CLIENT_ID="${cog_client}"
  manifest="$(mktemp -t whisper.XXXXXX.yaml)"
  envsubst < "${PROJECT_DIR}/k8s/whisper-serving.yaml" > "$manifest"
  kubectl apply -f "$manifest"; rm -f "$manifest"

  echo "  waiting for whisper rollout (GPU node + model load)..."
  kubectl rollout status deployment/storeai-whisper -n "$NS" --timeout=900s
  echo "  whisper service: ws://storeai-whisper.${NS}.svc.cluster.local:8765/whisper"
}

mod_teardown() { kubectl delete deployment,service storeai-whisper -n "$NS" --ignore-not-found >/dev/null 2>&1 || true; }
mod_verify() { kubectl get pods -n "$NS" -l app=storeai-whisper 2>/dev/null || true; }
