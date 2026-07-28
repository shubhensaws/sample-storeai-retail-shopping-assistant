#!/usr/bin/env bash
# Helm helpers for StoreAI deploy. Source this file.
set -euo pipefail

# helm_upgrade <release> <chart> <namespace> <values_file> [extra args...]
helm_upgrade() {
  local release="$1" chart="$2" ns="$3" values="$4"; shift 4
  helm upgrade --install "$release" "$chart" \
    --namespace "$ns" --create-namespace \
    -f "$values" --wait --timeout 10m "$@"
}

helm_uninstall() {
  local release="$1" ns="$2"
  helm uninstall "$release" --namespace "$ns" 2>/dev/null || true
}
