#!/usr/bin/env bash
# frontend (edge) — build the Next.js static export and publish to S3 + CloudFront.
# API calls are same-origin under /api (D-031): NEXT_PUBLIC_LAMBDA_API_URL=/api.
set -euo pipefail

_r() { python3 "${LIB_DIR}/resolve.py" --config "$1" get "$2" 2>/dev/null; }

mod_deploy() {
  local config="$1" region env demo tfdir src bucket dist pool client
  region=$(_r "$config" global.region); region="${region:-us-east-2}"
  env=$(_r "$config" global.env); env="${env:-dev}"
  demo=$(_r "$config" modules.cdn.demoMode); demo="${demo:-booth}"
  local avatar_enabled
  avatar_enabled=$(_r "$config" modules.avatar-heygen.enabled); avatar_enabled="${avatar_enabled:-false}"
  tfdir="${PROJECT_DIR}/infra/terraform"

  bucket=$(terraform -chdir="$tfdir" output -raw frontend_bucket)
  dist=$(terraform -chdir="$tfdir" output -raw cloudfront_distribution_id)
  pool=$(terraform -chdir="$tfdir" output -raw cognito_user_pool_id)
  client=$(terraform -chdir="$tfdir" output -raw cognito_client_id)

  src="${PROJECT_DIR}/components/frontend"; [ -d "$src" ] || src="${PROJECT_DIR}/frontend"

  echo "  building frontend (api=/api, demo=${demo}, pool=${pool})"
  (
    cd "$src"
    npm ci --no-audit --no-fund
    NEXT_PUBLIC_LAMBDA_API_URL="/api" \
    NEXT_PUBLIC_COGNITO_USER_POOL_ID="$pool" \
    NEXT_PUBLIC_COGNITO_WEB_CLIENT_ID="$client" \
    NEXT_PUBLIC_DEMO_MODE="$demo" \
    NEXT_PUBLIC_LIVEAVATAR_ENABLED="$avatar_enabled" \
      npm run build
  )

  echo "  uploading to s3://${bucket}"
  aws s3 sync "${src}/out/" "s3://${bucket}/" --delete --region "$region"
  echo "  invalidating CloudFront ${dist}"
  aws cloudfront create-invalidation --distribution-id "$dist" --paths "/*" --region "$region" >/dev/null
  echo "  frontend published."
}

mod_teardown() {
  local config="$1" region bucket tfdir
  region=$(_r "$config" global.region); region="${region:-us-east-2}"
  tfdir="${PROJECT_DIR}/infra/terraform"
  bucket=$(terraform -chdir="$tfdir" output -raw frontend_bucket 2>/dev/null || true)
  [ -n "${bucket:-}" ] && aws s3 rm "s3://${bucket}" --recursive --region "$region" >/dev/null 2>&1 || true
}

mod_verify() {
  local tfdir="${PROJECT_DIR}/infra/terraform"
  terraform -chdir="$tfdir" output -raw cloudfront_domain_name 2>/dev/null || true
}
