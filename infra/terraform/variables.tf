########################################
# StoreAI v2 — Root Variables
########################################

variable "region" {
  description = "AWS region for deployment"
  type        = string
  default     = "us-east-2"
}

variable "env_name" {
  description = "Environment name (affects all resource naming)"
  type        = string
  default     = "dev"
}

variable "custom_domain" {
  description = "Custom domain for ALB/CloudFront (optional; empty = CloudFront default domain)"
  type        = string
  default     = ""
}

variable "hosted_zone_id" {
  description = "Route53 hosted zone ID for custom_domain (required when custom_domain is set)"
  type        = string
  default     = ""
}

variable "alb_arn" {
  type        = string
  default     = "arn:aws:elasticloadbalancing:us-east-2:000000000000:loadbalancer/app/placeholder/0000000000000000"
  description = "Internal ALB ARN (from the orchestrator Ingress) for the CloudFront VPC origin. Placeholder default lets destroy validate; the deployer passes the real ARN on apply."
}

variable "alb_dns_name" {
  type        = string
  default     = "placeholder.elb.amazonaws.com"
  description = "Internal ALB DNS name for the CloudFront ALB origin. Deployer passes the real value on apply."
}

########################################
# Hybrid MNG accelerators (D-040)
########################################
variable "capacity_block_reservation_id" {
  description = "Neuron Capacity Block reservation ID. Seeds the SSM parameter on first apply; update the SSM parameter out-of-band for subsequent CBs, then re-apply."
  type        = string
  default     = ""
}

variable "capacity_block_az" {
  description = "Availability zone of the Capacity Block (e.g. us-east-2b)."
  type        = string
  default     = ""
}

variable "capacity_block_instance_type" {
  description = "Capacity Block instance type"
  type        = string
  default     = "trn2.48xlarge"
}

variable "capacity_block_ami_type" {
  description = "EKS MNG AMI type for the Capacity Block"
  type        = string
  default     = "AL2023_x86_64_NEURON"
}

variable "gpu_mng_enabled" {
  description = "Create the NVIDIA GPU managed node group"
  type        = bool
  default     = true
}

variable "gpu_node_desired" {
  description = "GPU MNG desired node count"
  type        = number
  default     = 2
}

variable "vton_alb_url" {
  description = "Internal ALB base URL for tryon-mcp -> VTON (post-k8s)."
  type        = string
  default     = ""
}

# ── Standalone image-edit endpoint ───────────────────────────────────────────
variable "image_edit_hostname" {
  description = "Hostname for the standalone image-edit endpoint (e.g. image-edit-dev.<domain>). Empty = endpoint DNS off."
  type        = string
  default     = ""
}

variable "image_edit_cert_arn" {
  description = "BYO ACM cert ARN for the image-edit endpoint. Empty = reuse the eks wildcard cert (*.custom_domain)."
  type        = string
  default     = ""
}

variable "image_edit_alb_dns_name" {
  description = "DNS name of the image-edit Ingress ALB (resolved post-k8s by the deploy CLI; empty pre-k8s)."
  type        = string
  default     = ""
}
