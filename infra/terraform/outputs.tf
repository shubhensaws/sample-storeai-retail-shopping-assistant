########################################
# StoreAI v2 — Root Outputs (Phase 1 foundation)
########################################

output "table_names" {
  description = "DynamoDB table names"
  value       = module.data_plane.table_names
}

output "tryon_bucket_name" {
  description = "Try-on S3 bucket"
  value       = module.data_plane.tryon_bucket_name
}

output "product_images_bucket_name" {
  description = "Product images S3 bucket"
  value       = module.data_plane.product_images_bucket_name
}

output "cognito_user_pool_id" {
  description = "Cognito user pool ID"
  value       = module.data_plane.cognito_user_pool_id
}

output "cognito_client_id" {
  description = "Cognito app client ID"
  value       = module.data_plane.cognito_client_id
}

output "ecr_repository_urls" {
  description = "ECR repository URLs"
  value       = module.ecr.repository_urls
}

output "eks_cluster_name" {
  description = "EKS cluster name"
  value       = module.eks.cluster_name
}

output "eks_cluster_endpoint" {
  description = "EKS cluster API endpoint"
  value       = module.eks.cluster_endpoint
}

########################################
# CDN (Phase 2.5)
########################################
output "cloudfront_domain_name" {
  value       = module.cdn.distribution_domain_name
  description = "Public store URL (CloudFront)"
}

output "app_url" {
  value       = module.cdn.app_url
  description = "Public app URL — custom storeai.<domain> when set, else the CloudFront URL"
}

output "cloudfront_distribution_id" {
  value = module.cdn.distribution_id
}

output "frontend_bucket" {
  value = module.cdn.frontend_bucket
}

output "image_edit_cert_arn" {
  description = "ACM cert ARN for the image-edit endpoint (BYO override, else the eks wildcard *.custom_domain)."
  value       = local.image_edit_cert_arn
}

output "image_edit_hostname" {
  description = "Resolved hostname for the standalone image-edit endpoint."
  value       = var.image_edit_hostname
}
