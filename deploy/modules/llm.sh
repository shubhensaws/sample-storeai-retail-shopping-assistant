#!/usr/bin/env bash
# llm-neuron (L1) — Qwen3-8B vLLM on the Trn2 Capacity-Block MNG (D-040). Requires the Neuron MNG
# (Terraform, CB id via SSM) + the Neuron device plugin/scheduler (helm, installed by `storeai up`).
# Compiles on first start via vLLM/NxDI, cached to the neuron-cache S3 bucket.
set -euo pipefail
NS="default"
mod_deploy() {
  local config="${1:-}" env acct region
  region=$(python3 "${LIB_DIR}/resolve.py" --config "$config" get global.region 2>/dev/null); region="${region:-us-east-2}"
  env=$(python3 "${LIB_DIR}/resolve.py" --config "$config" get global.env 2>/dev/null); env="${env:-dev}"
  acct=$(python3 "${LIB_DIR}/resolve.py" --config "$config" get global.accountId 2>/dev/null)
  { [ -z "$acct" ] || [ "$acct" = "auto" ] || [ "$acct" = "None" ]; } && acct=$(aws sts get-caller-identity --query Account --output text)
  export ENV="$env" ACCOUNT_ID="$acct" REGION="$region"
  envsubst '${ACCOUNT_ID} ${ENV} ${REGION}' < "${PROJECT_DIR}/k8s/llm-serving.yaml" | kubectl apply -f -
  echo "  storeai-llm applied (compiles on first run if S3 cache empty; rollout may take ~30 min cold)"
  kubectl rollout status deployment/storeai-llm -n "$NS" --timeout=2400s || true
}
mod_teardown() { kubectl delete -f "${PROJECT_DIR}/k8s/llm-serving.yaml" --ignore-not-found >/dev/null 2>&1 || true; }
mod_verify() { kubectl get pods -n "$NS" -l app=storeai-llm 2>/dev/null || true; }
