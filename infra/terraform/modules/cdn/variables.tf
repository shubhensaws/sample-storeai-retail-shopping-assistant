variable "env_name" {
  type        = string
  description = "Environment name (e.g. dev)"
}

variable "region" {
  type        = string
  description = "AWS region of the internal ALB / S3 buckets"
}

variable "price_class" {
  type        = string
  default     = "PriceClass_100"
  description = "CloudFront price class"
}

variable "tags" {
  type    = map(string)
  default = {}
}

# ALB (created by the orchestrator's EKS Ingress) passed in by the deployer, so
# the CDN module has no live dependency on the ALB — this avoids a data-source
# deadlock on teardown (D-036). Empty on destroy (state drives deletion).
variable "alb_arn" {
  type    = string
  default = ""
}

variable "alb_dns_name" {
  type    = string
  default = ""
}

# When set, the app is served at storeai.<custom_domain> via a CloudFront alias +
# a us-east-1 ACM cert + a Route53 CNAME. Empty => CloudFront default domain only.
# Never the bare domain (users bring existing domains) — always the storeai.* subdomain.
variable "custom_domain" {
  type    = string
  default = ""
}

variable "hosted_zone_id" {
  type    = string
  default = ""
}
