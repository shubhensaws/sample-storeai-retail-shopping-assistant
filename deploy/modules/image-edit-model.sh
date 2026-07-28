#!/usr/bin/env bash
# image-edit-model (L1) — Qwen-Image-Edit VTON on the Trn2 Capacity-Block MNG (D-040).
# Compile-if-needed (D-005): if the neuron-cache S3 bucket already holds compiled artifacts
# (vton-qwen/trn2), serve directly; otherwise run the one-shot compile Job first, then serve.
# Requires the Neuron MNG (Terraform, CB id via SSM) + Neuron device plugin/scheduler (helm).
# Reached in-cluster and via the internal ALB /vton (tryon-mcp QWEN_VTON_URL).
set -euo pipefail
NS="default"
_r() { python3 "${LIB_DIR}/resolve.py" --config "$1" get "$2" 2>/dev/null; }

mod_deploy() {
  local config="$1" env acct bucket
  env=$(_r "$config" global.env); env="${env:-dev}"
  acct=$(_r "$config" global.accountId)
  { [ -z "$acct" ] || [ "$acct" = "auto" ] || [ "$acct" = "None" ]; } && acct=$(aws sts get-caller-identity --query Account --output text)
  bucket="storeai-${env}-neuron-cache-${acct}"
  local region; region=$(_r "$config" global.region); region="${region:-us-east-2}"
  export ENV="$env" ACCOUNT_ID="$acct" REGION="$region"

  # Compile-if-needed: check the S3 cache for compiled VTON artifacts.
  local n
  n=$(aws s3 ls "s3://${bucket}/vton-qwen/trn2/" --recursive 2>/dev/null | grep -c . || true)
  if [ "${n:-0}" -lt 5 ]; then
    echo "  no cached VTON artifacts in s3://${bucket}/vton-qwen/trn2 — running compile Job first"
    aws s3 sync "${PROJECT_DIR}/vton-neuron/" "s3://${bucket}/vton-code/" \
      --exclude "*__pycache__*" --exclude "*.pyc" --delete --only-show-errors || true
    kubectl delete job vton-compile-trn2 -n "$NS" --ignore-not-found >/dev/null 2>&1 || true
    envsubst '${ACCOUNT_ID} ${ENV} ${REGION}' < "${PROJECT_DIR}/k8s/vton-compile-job.yaml" | kubectl apply -f -
    echo "  waiting for compile Job (this can take ~15-40 min on cold cache)..."
    kubectl wait --for=condition=complete job/vton-compile-trn2 -n "$NS" --timeout=3600s || \
      { echo "  compile Job did not complete in time; check: kubectl logs -n default job/vton-compile-trn2"; return 1; }
  else
    echo "  found ${n} cached VTON artifacts — skipping compile"
  fi

  envsubst '${ACCOUNT_ID} ${ENV} ${REGION}' < "${PROJECT_DIR}/k8s/vton-serving.yaml" | kubectl apply -f -
  kubectl rollout status deployment/storeai-vton -n "$NS" --timeout=1800s || true

  # ── Standalone image-edit endpoint (optional; enabled by imageEdit.hostname) ──
  local iehost iescheme ieauth region
  region=$(_r "$config" global.region); region="${region:-us-east-2}"
  iehost=$(_r "$config" imageEdit.hostname)
  iescheme=$(_r "$config" imageEdit.scheme); iescheme="${iescheme:-internal}"
  ieauth=$(_r "$config" imageEdit.authEnabled)

  # App-level Cognito JWT auth on the VTON pod (env-gated) when enabled.
  if [ "$ieauth" = "True" ] || [ "$ieauth" = "true" ]; then
    local pool client hostedui
    pool=$(aws ssm get-parameter --name "/app/storeai/${env}/cognito/user_pool_id" --region "$region" --query 'Parameter.Value' --output text 2>/dev/null || echo "")
    client=$(aws ssm get-parameter --name "/app/storeai/${env}/cognito/client_id" --region "$region" --query 'Parameter.Value' --output text 2>/dev/null || echo "")
    hostedui=$(_r "$config" imageEdit.hostedUi)
    if [ -n "$pool" ] && [ "$pool" != "None" ]; then
      kubectl set env deployment/storeai-vton -n "$NS" \
        COGNITO_USER_POOL_ID="$pool" COGNITO_REGION="$region" COGNITO_APP_CLIENT_ID="$client" \
        ${hostedui:+COGNITO_HOSTED_UI=$hostedui} >/dev/null 2>&1 && echo "  app-level Cognito auth enabled on storeai-vton (pool ${pool})" || true
    fi
  fi

  # Render + apply the standalone HTTPS ingress when a hostname is configured.
  if [ -n "$iehost" ] && [ "$iehost" != "None" ]; then
    local cert
    cert=$(cd "${PROJECT_DIR}/infra/terraform" && terraform output -raw image_edit_cert_arn 2>/dev/null || echo "")
    { [ -z "$cert" ] || [ "$cert" = "None" ]; } && cert=$(_r "$config" imageEdit.certArn)
    if [ -z "$cert" ] || [ "$cert" = "None" ]; then
      echo "  [warn] imageEdit.hostname set but no cert available (set global.customDomain for the eks wildcard, or imageEdit.certArn). Skipping ingress."
    else
      echo "  applying image-edit ingress: https://${iehost} (scheme=${iescheme})"
      local ieclass; [ "$iescheme" = "internet-facing" ] && ieclass="public-alb" || ieclass="internal-alb"
      IMAGE_EDIT_INGRESS_CLASS="$ieclass" IMAGE_EDIT_HOSTNAME="$iehost" IMAGE_EDIT_CERT_ARN="$cert" \
        envsubst '${IMAGE_EDIT_INGRESS_CLASS} ${IMAGE_EDIT_HOSTNAME} ${IMAGE_EDIT_CERT_ARN}' \
        < "${PROJECT_DIR}/k8s/image-edit-serving.yaml" | kubectl apply -f - >/dev/null \
        && echo "  image-edit ingress applied (Route53 record is created by the post-k8s Terraform pass)"
    fi
  fi
}
mod_teardown() {
  kubectl delete ingress image-edit -n "$NS" --ignore-not-found >/dev/null 2>&1 || true
  kubectl delete -f "${PROJECT_DIR}/k8s/vton-serving.yaml" --ignore-not-found >/dev/null 2>&1 || true
  kubectl delete job vton-compile-trn2 -n "$NS" --ignore-not-found >/dev/null 2>&1 || true
}
mod_verify() { kubectl get pods -n "$NS" -l app=storeai-vton 2>/dev/null || true; }
