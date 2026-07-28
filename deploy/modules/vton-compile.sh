#!/usr/bin/env bash
# vton-compile (ops) — one-shot Job that compiles Qwen-Image-Edit (v3_cfg) for Trn2 and uploads
# the artifacts to the neuron-cache S3 bucket. Run ONCE per model/instance change; vton-neuron
# then serves from the cache. Idempotent: if artifacts already exist in S3, serving skips compile.
set -euo pipefail
NS="default"
mod_deploy() {
  # Stage the compile toolkit to S3 so the Job can pull it.
  local acct; acct=$(aws sts get-caller-identity --query Account --output text 2>/dev/null)
  local env; env=$(python3 "${LIB_DIR}/resolve.py" --config "$1" get global.env 2>/dev/null); env="${env:-dev}"
  local region; region=$(python3 "${LIB_DIR}/resolve.py" --config "$1" get global.region 2>/dev/null); region="${region:-us-east-2}"
  aws s3 sync "${PROJECT_DIR}/vton-neuron/" "s3://storeai-${env}-neuron-cache-${acct}/vton-code/" \
    --exclude "*__pycache__*" --exclude "*.pyc" --exclude "*.ipynb_checkpoints*" --delete --only-show-errors || true
  kubectl delete job vton-compile-trn2 -n "$NS" --ignore-not-found >/dev/null 2>&1 || true
  export ENV="$env" ACCOUNT_ID="$acct" REGION="$region"
  envsubst '${ACCOUNT_ID} ${ENV} ${REGION}' < "${PROJECT_DIR}/k8s/vton-compile-job.yaml" | kubectl apply -f -
  echo "  vton-compile Job started (v3_cfg, ~11 min on cache-warm HF, longer cold). Monitor: kubectl logs -n default job/vton-compile-trn2"
}
mod_teardown() { kubectl delete job vton-compile-trn2 -n "$NS" --ignore-not-found >/dev/null 2>&1 || true; }
mod_verify() { kubectl get job vton-compile-trn2 -n "$NS" 2>/dev/null || true; }
