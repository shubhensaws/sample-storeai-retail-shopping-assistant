#!/usr/bin/env bash
# voice-nova (L2) — build the Nova Sonic STT/TTS image (arm64) and deploy to EKS.
# Bedrock direct (D-021); Nova Sonic region = us-east-1 (D-037).
set -euo pipefail

NS="default"
_r() { python3 "${LIB_DIR}/resolve.py" --config "$1" get "$2" 2>/dev/null; }

mod_deploy() {
  local config="$1" region env account repo tag ecr_uri src
  region=$(_r "$config" global.region); region="${region:-us-east-2}"
  env=$(_r "$config" global.env); env="${env:-dev}"
  account=$(_r "$config" global.accountId)
  if [ -z "$account" ] || [ "$account" = "auto" ] || [ "$account" = "None" ]; then
    account=$(aws sts get-caller-identity --query Account --output text)
  fi
  src="${PROJECT_DIR}/components/voice-nova"; [ -d "$src" ] || src="${PROJECT_DIR}/nova-sonic"
  repo="storeai-${env}-nova-sonic"
  tag="$(cd "$PROJECT_DIR" && git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
  ecr_uri="${account}.dkr.ecr.${region}.amazonaws.com/${repo}"

  echo "  building voice-nova image (arm64) → ${ecr_uri}:${tag}"
  aws ecr get-login-password --region "$region" | podman login --username AWS --password-stdin "${account}.dkr.ecr.${region}.amazonaws.com" >/dev/null
  podman build --platform linux/arm64 -t "${ecr_uri}:${tag}" -t "${ecr_uri}:latest" "$src"
  podman push "${ecr_uri}:${tag}"; podman push "${ecr_uri}:latest"

  local cog_pool cog_client
  cog_pool=$(terraform -chdir="${PROJECT_DIR}/infra/terraform" output -raw cognito_user_pool_id 2>/dev/null || true)
  cog_client=$(terraform -chdir="${PROJECT_DIR}/infra/terraform" output -raw cognito_client_id 2>/dev/null || true)
  export REGION="$region" ENV="$env" ACCOUNT_ID="$account" IMAGE_TAG="$tag" COGNITO_USER_POOL_ID="${cog_pool}" COGNITO_APP_CLIENT_ID="${cog_client}"
  local manifest; manifest="$(mktemp -t voice-nova.XXXXXX.yaml)"
  envsubst < "${PROJECT_DIR}/k8s/voice-nova-serving.yaml" > "$manifest"
  kubectl apply -f "$manifest"; rm -f "$manifest"
  kubectl rollout status deployment/storeai-voice-nova -n "$NS" --timeout=300s
  echo "  voice-nova service: ws://storeai-voice-nova.${NS}.svc.cluster.local:8505 (/stt, /tts)"
}

mod_teardown() {
  kubectl delete deployment,service storeai-voice-nova -n "$NS" --ignore-not-found >/dev/null 2>&1 || true
}

mod_verify() { kubectl get pods -n "$NS" -l app=storeai-voice-nova 2>/dev/null || true; }
