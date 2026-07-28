variable "env_name" { type = string }
variable "region" { type = string }

variable "table_names" {
  description = "Map of DynamoDB table key -> full name (from data-plane)"
  type        = map(string)
}

variable "tryon_bucket" { type = string }
variable "product_images_bucket" { type = string }

variable "vpc_id" { type = string }
variable "private_subnet_ids" { type = list(string) }

variable "mcp_source_root" {
  description = "Absolute path to components/mcp"
  type        = string
}
variable "vton_alb_url" {
  description = "Internal ALB base URL (http://<alb-dns>) for tryon-mcp to reach in-cluster VTON services. Resolved post-k8s by the deploy CLI."
  type        = string
  default     = ""
}

variable "vector_bucket_name" {
  description = "S3 Vectors bucket for long-term customer memory (from memory-search module)."
  type        = string
  default     = ""
}

variable "memory_index_name" {
  description = "S3 Vectors index name for customer memory."
  type        = string
  default     = "customer-memory"
}
