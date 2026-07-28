# LiteLLM Helm values (rendered by deploy/modules/litellm-gateway.sh via envsubst).
# Bound to the storeai-services ServiceAccount so pods get Bedrock access via
# EKS Pod Identity (D-019/D-021). Bundled Postgres (deployStandalone) backs the
# chart's own key/config store; our per-call cost aggregation is app-side (D-026).

serviceAccount:
  create: true
  name: storeai-services

db:
  # DB-less: LiteLLM runs as a pure proxy (routing + per-call cost in response);
  # cost aggregation is app-side (D-026). Avoids the deprecated Bitnami postgres image.
  deployStandalone: false
  useExisting: false

migrationJob:
  enabled: false

# Pin the gateway to Graviton (arm64) nodes, matching the other general services
# (orchestrator, voice, avatar). The BerriAI LiteLLM image is published multi-arch.
nodeSelector:
  kubernetes.io/arch: arm64

# Rendered into the proxy config.yaml. Backends registered here; adding a model
# is a config change, no code change (D-010).
proxy_config:
  model_list:
    - model_name: bedrock-claude
      litellm_params:
        model: bedrock/${CHAT_MODEL}
        aws_region_name: ${LITELLM_REGION}
      model_info:
        mode: chat
    - model_name: bedrock-haiku
      litellm_params:
        model: bedrock/${ROUTER_MODEL}
        aws_region_name: ${LITELLM_REGION}
      model_info:
        mode: chat
    # Self-hosted Qwen3-8B on Trainium2 (Phase 4 / D-040), OpenAI-compatible vLLM
    # served in-cluster. Adding it here makes it a selectable backend with no code change.
    - model_name: neuron-qwen3
      litellm_params:
        model: hosted_vllm/qwen3-8b
        api_base: http://storeai-llm.default.svc.cluster.local:8080/v1
        api_key: dummy
      model_info:
        mode: chat
    # Amazon Nova Pro and Anthropic Claude Opus 4.1 on Bedrock (verified accessible
    # in-account). Registered so the UI's model options are honored 1:1.
    - model_name: bedrock-nova-pro
      litellm_params:
        model: bedrock/us.amazon.nova-pro-v1:0
        aws_region_name: ${LITELLM_REGION}
      model_info:
        mode: chat
    - model_name: bedrock-opus
      litellm_params:
        model: bedrock/us.anthropic.claude-opus-4-1-20250805-v1:0
        aws_region_name: ${LITELLM_REGION}
      model_info:
        mode: chat
  litellm_settings:
    drop_params: true
  general_settings:
    # master key is injected via --set masterkey at deploy time (not in git)
    telemetry: false
