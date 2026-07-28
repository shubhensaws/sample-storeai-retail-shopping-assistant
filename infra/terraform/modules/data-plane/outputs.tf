output "table_arns" {
  description = "Map of DynamoDB table name keys to ARNs"
  value       = { for k, v in aws_dynamodb_table.tables : k => v.arn }
}

output "table_names" {
  description = "Map of DynamoDB table name keys to full table names"
  value       = { for k, v in aws_dynamodb_table.tables : k => v.name }
}

output "tryon_bucket_name" {
  description = "Try-on S3 bucket name"
  value       = aws_s3_bucket.tryon.id
}

output "tryon_bucket_arn" {
  description = "Try-on S3 bucket ARN"
  value       = aws_s3_bucket.tryon.arn
}

output "product_images_bucket_name" {
  description = "Product images S3 bucket name"
  value       = aws_s3_bucket.product_images.id
}

output "product_images_bucket_arn" {
  description = "Product images S3 bucket ARN"
  value       = aws_s3_bucket.product_images.arn
}

output "cognito_user_pool_id" {
  description = "Cognito user pool ID"
  value       = aws_cognito_user_pool.main.id
}

output "cognito_client_id" {
  description = "Cognito app client ID"
  value       = aws_cognito_user_pool_client.main.id
}
