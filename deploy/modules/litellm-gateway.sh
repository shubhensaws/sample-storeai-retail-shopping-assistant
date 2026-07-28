#!/usr/bin/env bash
# litellm-gateway (L3) — unified AI gateway via the official LiteLLM Helm chart
# (CL-4/D-027). Bound to storeai-services SA for Bedrock (Pod Identity).
set -euo pipefail

LITELLM_CHART="oci://ghcr.io/berriai/litellm-helm"
LITELLM_NS="default"

mod_deploy() {
  local config="$1" region env model values mkey ssm
  region=$(python3 "${LIB_DIR}/resolve.py" --config "$config" get global.region)
  env=$(python3 "${LIB_DIR}/resolve.py" --config "$config" get global.env)
  model=$(python3 "${LIB_DIR}/resolve.py" --config "$config" get engines.llm.backends.bedrock-claude.model)
  local router_model
  router_model=$(python3 "${LIB_DIR}/resolve.py" --config "$config" get engines.llm.backends.bedrock-haiku.model)
  export CHAT_MODEL="${model:-us.anthropic.claude-sonnet-4-6}"
  export ROUTER_MODEL="${router_model:-us.anthropic.claude-haiku-4-5-20251001-v1:0}"
  export LITELLM_REGION="${region:-us-east-2}"
  ssm="/storeai-${env:-dev}/litellm/master-key"

  values="$(mktemp -t litellm-values.XXXXXX.yaml)"
  envsubst < "${PROJECT_DIR}/k8s/litellm-values.yaml.tpl" > "$values"

  # Persist master key in SSM (stable across deploys). The chart creates its own
  # k8s secret from --set masterkey, so we must NOT pre-create one.
  mkey="$(aws ssm get-parameter --name "$ssm" --with-decryption --region "$LITELLM_REGION" --query 'Parameter.Value' --output text 2>/dev/null || true)"
  if [ -z "$mkey" ] || [ "$mkey" = "None" ]; then
    mkey="sk-$(openssl rand -hex 20)"
    aws ssm put-parameter --name "$ssm" --type SecureString --value "$mkey" --overwrite --region "$LITELLM_REGION" >/dev/null
  fi

  echo "  deploying LiteLLM (model: ${CHAT_MODEL})..."
  helm_upgrade litellm "$LITELLM_CHART" "$LITELLM_NS" "$values" --set masterkey="$mkey"
  rm -f "$values"
  echo "  LiteLLM gateway service: http://litellm.${LITELLM_NS}.svc.cluster.local:4000"
}

mod_teardown() {
  local config="$1" region env
  region=$(python3 "${LIB_DIR}/resolve.py" --config "$config" get global.region)
  env=$(python3 "${LIB_DIR}/resolve.py" --config "$config" get global.env)
  helm_uninstall litellm "$LITELLM_NS"
  kubectl delete pvc -n "$LITELLM_NS" -l app.kubernetes.io/name=postgresql --ignore-not-found >/dev/null 2>&1 || true
  aws ssm delete-parameter --name "/storeai-${env:-dev}/litellm/master-key" --region "${region:-us-east-2}" >/dev/null 2>&1 || true
}

mod_verify() {
  kubectl get pods -n "$LITELLM_NS" -l app.kubernetes.io/instance=litellm 2>/dev/null || true
}
