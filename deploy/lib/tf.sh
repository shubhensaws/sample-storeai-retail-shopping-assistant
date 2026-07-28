#!/usr/bin/env bash
# Terraform helpers for StoreAI deploy. Source this file.
set -euo pipefail

TF_DIR="${PROJECT_DIR}/infra/terraform"

# Build backend-config args from the config (bucket/key/region). Key is per-env.
_tf_backend_args() {
  local config="$1"
  local bucket prefix env region key
  bucket=$(python3 "${LIB_DIR}/resolve.py" --config "$config" get global.tfStateBucket)
  prefix=$(python3 "${LIB_DIR}/resolve.py" --config "$config" get global.stateKeyPrefix)
  env=$(python3 "${LIB_DIR}/resolve.py" --config "$config" get global.env)
  region=$(python3 "${LIB_DIR}/resolve.py" --config "$config" get global.region)
  local sbregion
  sbregion=$(python3 "${LIB_DIR}/resolve.py" --config "$config" get global.stateBucketRegion)
  [ -z "$sbregion" ] && sbregion="$region"
  key="${prefix:-retail-shopping-agent/storeai}/${env:-dev}/terraform.tfstate"
  echo "-backend-config=bucket=${bucket} -backend-config=key=${key} -backend-config=region=${sbregion} -backend-config=encrypt=true"
}

_tf_var_args() {
  local config="$1" env region
  env=$(python3 "${LIB_DIR}/resolve.py" --config "$config" get global.env)
  region=$(python3 "${LIB_DIR}/resolve.py" --config "$config" get global.region)
  env="${env:-dev}"; region="${region:-us-east-2}"
  local args="-var=env_name=${env} -var=region=${region}"
  # Neuron Capacity Block id: resolved from SSM (TF seeds the param; user rotates it out-of-band,
  # see PHASE-4 §8). Empty/not-set => Neuron MNG is skipped. Bridges SSM -> var (plan-determinable).
  local cbid cbaz
  # CB reservation id: config is the source of truth (D-013 — config -> TF -> SSM param,
  # created/destroyed with the infra). Fall back to the SSM param only when config is empty
  # (e.g. an out-of-band rotation via scripts/rotate-capacity-block.sh). Passing the value as
  # -var also keeps the Neuron MNG count plan-determinable and avoids the first-apply
  # "parameter not found" data-source read.
  cbid=$(python3 "${LIB_DIR}/resolve.py" --config "$config" get prerequisites.capacityBlock.reservationId 2>/dev/null)
  { [ -z "$cbid" ] || [ "$cbid" = "None" ]; } && cbid=$(aws ssm get-parameter --name "/storeai-${env}/neuron/capacity_block_reservation_id" --region "$region" --query 'Parameter.Value' --output text 2>/dev/null || echo "")
  [ "$cbid" = "not-set" ] && cbid=""
  { [ -n "$cbid" ] && [ "$cbid" != "None" ]; } && args="${args} -var=capacity_block_reservation_id=${cbid}"
  cbaz=$(python3 "${LIB_DIR}/resolve.py" --config "$config" get global.capacityBlockAz 2>/dev/null || echo "")
  [ -n "$cbaz" ] && [ "$cbaz" != "None" ] && args="${args} -var=capacity_block_az=${cbaz}"
  # Post-k8s: internal ALB URL for tryon-mcp -> in-cluster VTON (set by do_up's second pass).
  [ -n "${VTON_ALB_URL:-}" ] && args="${args} -var=vton_alb_url=${VTON_ALB_URL}"
  # Post-k8s: CloudFront (cdn) backend origin — the EKS ingress ALB (also set by do_up's second pass).
  [ -n "${ALB_DNS_NAME:-}" ] && args="${args} -var=alb_dns_name=${ALB_DNS_NAME}"
  [ -n "${ALB_ARN:-}" ] && args="${args} -var=alb_arn=${ALB_ARN}"
  # Custom domain + hosted zone (enable the eks wildcard cert + Route53). From config.
  local cdom hz
  cdom=$(python3 "${LIB_DIR}/resolve.py" --config "$config" get global.customDomain 2>/dev/null || echo "")
  hz=$(python3 "${LIB_DIR}/resolve.py" --config "$config" get global.hostedZoneId 2>/dev/null || echo "")
  [ -n "$cdom" ] && [ "$cdom" != "None" ] && args="${args} -var=custom_domain=${cdom}"
  [ -n "$hz" ] && [ "$hz" != "None" ] && args="${args} -var=hosted_zone_id=${hz}"
  # Standalone image-edit endpoint: hostname + BYO cert (config); ALB DNS is post-k8s.
  local iehost iecert
  iehost=$(python3 "${LIB_DIR}/resolve.py" --config "$config" get imageEdit.hostname 2>/dev/null || echo "")
  iecert=$(python3 "${LIB_DIR}/resolve.py" --config "$config" get imageEdit.certArn 2>/dev/null || echo "")
  [ -n "$iehost" ] && [ "$iehost" != "None" ] && args="${args} -var=image_edit_hostname=${iehost}"
  [ -n "$iecert" ] && [ "$iecert" != "None" ] && args="${args} -var=image_edit_cert_arn=${iecert}"
  [ -n "${IMAGE_EDIT_ALB_DNS_NAME:-}" ] && args="${args} -var=image_edit_alb_dns_name=${IMAGE_EDIT_ALB_DNS_NAME}"
  echo "$args"
}

tf_init() {
  local config="$1"
  echo "== terraform init =="
  ( cd "$TF_DIR" && terraform init -reconfigure $(_tf_backend_args "$config") )
}

tf_plan() {
  local config="$1"; shift
  local targets="$*"
  ( cd "$TF_DIR" && terraform plan $(_tf_var_args "$config") ${targets} )
}

tf_apply() {
  local config="$1" auto="$2"; shift 2
  local targets="$*"
  local approve=""; [ "$auto" = "yes" ] && approve="-auto-approve"
  ( cd "$TF_DIR" && terraform apply $(_tf_var_args "$config") ${targets} ${approve} )
}

tf_destroy() {
  local config="$1" auto="$2"; shift 2
  local targets="$*"
  local approve=""; [ "$auto" = "yes" ] && approve="-auto-approve"
  # Retry with backoff. The VPC/IGW destroy commonly races AWS-managed ENIs that
  # are torn down asynchronously (Lambda Hyperplane ENIs, EKS Auto Mode / LB
  # controller ENIs). Terraform can't see those out-of-state ENIs, so it may hit
  # "DependencyViolation: ... has some mapped public address(es)" on the IGW/VPC.
  # terraform destroy is idempotent, so retrying after the ENIs drain lets a
  # single `storeai down --all` finish cleanly instead of requiring a manual
  # re-run. Waits escalate (60s..300s) to cover slow Hyperplane ENI release.
  local waits=(60 120 180 240 300) i
  for i in "${!waits[@]}"; do
    if ( cd "$TF_DIR" && terraform destroy $(_tf_var_args "$config") ${targets} ${approve} ); then
      return 0
    fi
    echo "== terraform destroy attempt $((i+1)) failed (likely a transient VPC/ENI dependency race); waiting ${waits[$i]}s for AWS-managed ENIs to drain, then retrying ==" >&2
    sleep "${waits[$i]}"
  done
  # Final attempt after the last backoff.
  ( cd "$TF_DIR" && terraform destroy $(_tf_var_args "$config") ${targets} ${approve} )
}
