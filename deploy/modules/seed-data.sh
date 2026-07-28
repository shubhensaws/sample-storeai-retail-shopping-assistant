#!/usr/bin/env bash
# seed-data (ops) — load the product catalog (DynamoDB) + product images (S3)
# via scripts/seed-products.py. Idempotent (the script clears + reloads products).
set -euo pipefail

_r() { python3 "${LIB_DIR}/resolve.py" --config "$1" get "$2" 2>/dev/null; }

mod_deploy() {
  local config="$1" region env tfdir table bucket account
  region=$(_r "$config" global.region); region="${region:-us-east-2}"
  env=$(_r "$config" global.env); env="${env:-dev}"
  tfdir="${PROJECT_DIR}/infra/terraform"

  table="storeai-${env}-products"
  bucket=$(terraform -chdir="$tfdir" output -raw product_images_bucket_name 2>/dev/null || true)
  if [ -z "${bucket:-}" ] || [ "$bucket" = "None" ]; then
    account=$(aws sts get-caller-identity --query Account --output text)
    bucket="storeai-${env}-product-images-${account}"
  fi

  echo "  seeding catalog → ${table} + s3://${bucket}"
  python3 "${PROJECT_DIR}/scripts/seed-products.py" \
    --table "$table" \
    --images-bucket "$bucket" \
    --data-dir "${PROJECT_DIR}/data" \
    --region "$region"
}

mod_teardown() {
  # Product data is disposable but harmless to leave; DynamoDB/S3 are torn down with data-plane.
  :
}

mod_verify() {
  local config="$1" region env
  region=$(_r "$config" global.region); region="${region:-us-east-2}"
  env=$(_r "$config" global.env); env="${env:-dev}"
  aws dynamodb scan --table-name "storeai-${env}-products" --select COUNT --region "$region" --query 'Count' --output text 2>/dev/null || true
}
