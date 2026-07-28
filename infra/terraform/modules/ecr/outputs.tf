output "repository_urls" {
  description = "Map of repository name keys to ECR URLs"
  value       = { for k, v in aws_ecr_repository.repos : k => v.repository_url }
}
