#!/usr/bin/env bash
# Preflight checks for StoreAI deploy. Source this file; call `preflight <config>`.
set -euo pipefail

preflight() {
  local config="$1"
  local fail=0
  echo "== Preflight =="

  # 1. Required CLIs (Phase 1 core). kubectl/helm/node/docker are checked as warnings
  #    since they're only needed from Phase 2 onward.
  local required=(terraform aws python3 jq)
  local optional=(kubectl helm node npm docker envsubst)
  for c in "${required[@]}"; do
    if command -v "$c" >/dev/null 2>&1; then
      echo "  ok   $c"
    else
      echo "  MISS $c (required)"; fail=1
    fi
  done
  for c in "${optional[@]}"; do
    command -v "$c" >/dev/null 2>&1 && echo "  ok   $c" || echo "  warn $c (needed in later phases)"
  done

  # 2. Container runtime (needed for image builds, Phase 2+)
  if command -v docker >/dev/null 2>&1 || command -v podman >/dev/null 2>&1; then
    echo "  ok   container runtime"
  else
    echo "  warn no docker/podman (needed to build images in Phase 2+)"
  fi

  # 3. AWS credentials
  if aws sts get-caller-identity >/dev/null 2>&1; then
    local acct; acct=$(aws sts get-caller-identity --query Account --output text)
    echo "  ok   aws credentials (account ${acct})"
  else
    echo "  MISS aws credentials — run 'aws configure' / set profile"; fail=1
  fi

  # 4. Terraform state bucket must EXIST (user-provided, D-013 — not created by us)
  local bucket region
  bucket=$(python3 "${LIB_DIR}/resolve.py" --config "$config" get global.tfStateBucket)
  region=$(python3 "${LIB_DIR}/resolve.py" --config "$config" get global.region)
  if [ -z "$bucket" ]; then
    echo "  MISS global.tfStateBucket not set in config"; fail=1
  elif aws s3api head-bucket --bucket "$bucket" --region "${region:-us-east-2}" >/dev/null 2>&1; then
    echo "  ok   tf state bucket s3://${bucket}"
  else
    echo "  MISS tf state bucket s3://${bucket} not found/accessible (create it first — D-013)"; fail=1
  fi

  # 5. Config validates against schema (best-effort; needs jsonschema)
  if python3 -c "import jsonschema" >/dev/null 2>&1; then
    if python3 -c "
import json,sys,jsonschema
s=json.load(open('${CONFIG_DIR}/schema.json')); c=json.load(open('$config'))
jsonschema.validate(c,s)" 2>/dev/null; then
      echo "  ok   config schema valid"
    else
      echo "  MISS config failed schema validation"; fail=1
    fi
  else
    echo "  warn jsonschema not installed — schema check skipped (pip install jsonschema)"
  fi

  # 6. Prerequisites for enabled modules
  if python3 "${LIB_DIR}/resolve.py" --config "$config" ${MODULE_ARGS:-} validate >/dev/null 2>&1; then
    echo "  ok   module prerequisites satisfied"
  else
    echo "  MISS module prerequisites (details below):"
    python3 "${LIB_DIR}/resolve.py" --config "$config" ${MODULE_ARGS:-} validate || true
    fail=1
  fi

  [ "$fail" -eq 0 ] && echo "Preflight passed." || { echo "Preflight FAILED."; return 1; }
}
