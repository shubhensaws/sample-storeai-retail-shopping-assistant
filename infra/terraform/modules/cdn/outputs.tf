output "distribution_id" {
  value       = aws_cloudfront_distribution.main.id
  description = "CloudFront distribution ID (for cache invalidation)"
}

output "distribution_domain_name" {
  value       = aws_cloudfront_distribution.main.domain_name
  description = "CloudFront domain (the public store URL)"
}

output "app_url" {
  value       = local.enable_custom_domain ? "https://${local.app_domain}" : "https://${aws_cloudfront_distribution.main.domain_name}"
  description = "Public app URL — custom subdomain (storeai.<domain>) when set, else the CloudFront URL"
}

output "frontend_bucket" {
  value       = aws_s3_bucket.frontend.bucket
  description = "S3 bucket for the static frontend"
}
