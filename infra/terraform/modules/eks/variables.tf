variable "env_name" {
  description = "Environment name"
  type        = string
}

variable "region" {
  description = "AWS region for resources"
  type        = string
}

variable "cluster_name" {
  description = "EKS cluster name"
  type        = string
}

variable "custom_domain" {
  description = "Custom domain for ALB/ACM (e.g. store.example.com). Empty = skip ACM/Route53."
  type        = string
  default     = ""
}

variable "hosted_zone_id" {
  description = "Route53 hosted zone ID for custom_domain. Required when custom_domain is set."
  type        = string
  default     = ""
}

variable "vpc_id" {
  description = "VPC id (from network module)"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet ids for nodes/workloads"
  type        = list(string)
}

variable "private_subnet_ids_by_az" {
  description = "Map of AZ -> private subnet id (used to place the Neuron CB MNG in the CB's AZ without a plan-time data source lookup)"
  type        = map(string)
  default     = {}
}

variable "public_subnet_ids" {
  description = "Public subnet ids (for internet-facing LB / NAT AZ coverage)"
  type        = list(string)
}

########################################
# Managed Node Groups (hybrid with Auto Mode) — GPU (NVIDIA) + Neuron (Trn2 Capacity Block)
# Per D-040: accelerators run on MNG (Auto Mode managed device plugins have gaps).
########################################

# --- Neuron Capacity Block MNG ---
variable "capacity_block_reservation_id" {
  description = "Capacity Block reservation ID (e.g. cr-0123...). Leave empty to seed the SSM parameter with 'not-set' and skip the Neuron MNG. This value seeds the SSM parameter on first apply; thereafter update the SSM parameter out-of-band (it is ignore_changes) and re-apply."
  type        = string
  default     = ""
}

variable "capacity_block_instance_type" {
  description = "Capacity Block instance type"
  type        = string
  default     = "trn2.48xlarge"
}

variable "capacity_block_ami_type" {
  description = "EKS MNG AMI type for the Capacity Block (AL2023_x86_64_NEURON for Trainium/Inferentia)"
  type        = string
  default     = "AL2023_x86_64_NEURON"
}

variable "capacity_block_az" {
  description = "Availability zone of the Capacity Block (e.g. us-east-2b). Filters MNG subnets to match the reservation AZ."
  type        = string
  default     = ""
}

variable "capacity_block_node_count" {
  description = "Number of Capacity Block nodes (= reserved instance count)"
  type        = number
  default     = 1
}

# --- GPU (NVIDIA) MNG ---
variable "gpu_mng_enabled" {
  description = "Create the on-demand NVIDIA GPU managed node group"
  type        = bool
  default     = true
}

variable "gpu_instance_type" {
  description = "GPU MNG instance type"
  type        = string
  default     = "g6.xlarge"
}

variable "gpu_ami_type" {
  description = "EKS MNG AMI type for GPU nodes (AL2023_x86_64_NVIDIA bakes the NVIDIA driver)"
  type        = string
  default     = "AL2023_x86_64_NVIDIA"
}

variable "gpu_node_min" {
  description = "GPU MNG min size (0 enables scale-to-zero when idle)"
  type        = number
  default     = 0
}

variable "gpu_node_max" {
  description = "GPU MNG max size"
  type        = number
  default     = 2
}

variable "gpu_node_desired" {
  description = "GPU MNG desired size"
  type        = number
  default     = 2
}
