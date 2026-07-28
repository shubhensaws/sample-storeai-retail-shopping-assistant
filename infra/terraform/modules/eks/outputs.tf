output "cluster_name" {
  value = aws_eks_cluster.main.name
}

output "cluster_endpoint" {
  value = aws_eks_cluster.main.endpoint
}

output "cluster_ca" {
  value = aws_eks_cluster.main.certificate_authority[0].data
}

output "node_role_arn" {
  value = aws_iam_role.node_auto.arn
}

output "voice_pod_role_arn" {
  description = "Pod Identity role for storeai-services (Bedrock + Lambda invoke)"
  value       = aws_iam_role.voice_pod.arn
}

output "acm_certificate_arn" {
  description = "Regional ACM cert ARN for the ALB (empty if no custom domain)"
  value       = local.has_dns ? aws_acm_certificate.services[0].arn : ""
}
