########################################
# Memory Search — Amazon S3 Vectors (long-term customer memory)
#
# S3 Vectors provides cost-optimized, serverless vector storage (no idle OCU
# floor like OpenSearch Serverless). The native `aws_s3vectors_*` resources
# require aws provider v6.x; this repo pins aws ~> 5.0, so we provision the
# vector bucket + index via the `aws s3vectors` CLI wrapped in null_resource
# with create + when=destroy cleanup. This keeps the resources Terraform-managed
# (created on apply, deleted on destroy) with zero blast radius on the rest of
# the stack. Future: migrate to declarative aws_s3vectors_* (provider 6.x) or
# awscc_s3vectors_* once we bump the provider.
#
# Vectors: Titan Text Embeddings v2 (1024-dim), cosine distance.
# Metadata: customer_id/kind/created_at are filterable; the large `text` field
# is marked non-filterable to stay within per-vector filterable-metadata limits.
########################################

variable "env_name" { type = string }
variable "region" { type = string }

locals {
  bucket    = "storeai-${var.env_name}-mem-vectors"
  index     = "customer-memory"
  dimension = 1024
  metric    = "cosine"
}

resource "null_resource" "vector_bucket" {
  triggers = {
    bucket = local.bucket
    region = var.region
  }

  # Create (idempotent: skip if it already exists).
  provisioner "local-exec" {
    command = <<-EOT
      set -e
      if ! aws s3vectors get-vector-bucket --vector-bucket-name "${local.bucket}" --region "${var.region}" >/dev/null 2>&1; then
        aws s3vectors create-vector-bucket --vector-bucket-name "${local.bucket}" --region "${var.region}"
        echo "created vector bucket ${local.bucket}"
      else
        echo "vector bucket ${local.bucket} already exists"
      fi
    EOT
  }

  # Destroy: remove the bucket (its indexes are removed first via depends_on).
  provisioner "local-exec" {
    when    = destroy
    command = "aws s3vectors delete-vector-bucket --vector-bucket-name \"${self.triggers.bucket}\" --region \"${self.triggers.region}\" || true"
  }
}

resource "null_resource" "vector_index" {
  depends_on = [null_resource.vector_bucket]

  triggers = {
    bucket    = local.bucket
    index     = local.index
    region    = var.region
    dimension = local.dimension
    metric    = local.metric
  }

  # Create (idempotent). `text` is non-filterable; customer_id/kind/created_at stay filterable.
  provisioner "local-exec" {
    command = <<-EOT
      set -e
      if ! aws s3vectors get-index --vector-bucket-name "${local.bucket}" --index-name "${local.index}" --region "${var.region}" >/dev/null 2>&1; then
        aws s3vectors create-index \
          --vector-bucket-name "${local.bucket}" \
          --index-name "${local.index}" \
          --data-type float32 \
          --dimension ${local.dimension} \
          --distance-metric ${local.metric} \
          --metadata-configuration '{"nonFilterableMetadataKeys":["text"]}' \
          --region "${var.region}"
        echo "created vector index ${local.index}"
      else
        echo "vector index ${local.index} already exists"
      fi
    EOT
  }

  # Destroy: delete the index before the bucket (reverse dependency order).
  provisioner "local-exec" {
    when    = destroy
    command = "aws s3vectors delete-index --vector-bucket-name \"${self.triggers.bucket}\" --index-name \"${self.triggers.index}\" --region \"${self.triggers.region}\" || true"
  }
}

output "vector_bucket_name" {
  value      = local.bucket
  depends_on = [null_resource.vector_index]
}

output "index_name" {
  value      = local.index
  depends_on = [null_resource.vector_index]
}
