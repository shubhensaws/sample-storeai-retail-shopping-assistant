#!/usr/bin/env bash
# Kubernetes helpers for StoreAI deploy. Source this file.
set -euo pipefail

k8s_kubeconfig() {
  local config="$1" env region cluster
  env=$(python3 "${LIB_DIR}/resolve.py" --config "$config" get global.env)
  region=$(python3 "${LIB_DIR}/resolve.py" --config "$config" get global.region)
  cluster="storeai-${env:-dev}"
  aws eks update-kubeconfig --name "$cluster" --region "${region:-us-east-2}" >/dev/null
}

# Apply a manifest, expanding ${VARS} via envsubst.
k8s_apply() {
  envsubst < "$1" | kubectl apply -f -
}

k8s_rollout() {
  # $1 = "deployment/name" ; $2 = namespace (default)
  kubectl rollout status "$1" -n "${2:-default}" --timeout="${3:-300s}"
}

k8s_delete() {
  envsubst < "$1" | kubectl delete -f - --ignore-not-found=true 2>/dev/null || true
}
