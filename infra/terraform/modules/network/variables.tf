variable "env_name" {
  type        = string
  description = "Environment name"
}

variable "region" {
  type        = string
  description = "AWS region"
}

variable "vpc_cidr" {
  type        = string
  default     = "10.0.0.0/16"
  description = "VPC CIDR"
}

variable "az_count" {
  type        = number
  default     = 2
  description = "Number of AZs (public+private subnet pairs)"
}

variable "cluster_name" {
  type        = string
  description = "EKS cluster name (for subnet ownership tags)"
}
