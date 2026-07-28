########################################
# StoreAI v2 — Root Terraform Configuration
#
# Phase 1 wires the network-agnostic foundation modules: data-plane + ecr.
# eks / lambdas / cdn are added in later increments (eks gated on OQ-6).
########################################

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }

  # Partial backend config — bucket/key/region are supplied at `terraform init`
  # via -backend-config (see deploy/lib/tf.sh). Per D-013:
  #   bucket = your-terraform-state-bucket
  #   key    = retail-shopping-agent/storeai/<env>/terraform.tfstate
  #   region = us-east-2
  backend "s3" {}
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "StoreAI"
      Environment = var.env_name
      ManagedBy   = "terraform"
    }
  }
}

# CloudFront viewer certificates must live in us-east-1 regardless of the app region.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = "StoreAI"
      Environment = var.env_name
      ManagedBy   = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

########################################
# Module: Data Plane (DynamoDB, S3, Cognito, SSM)
########################################
module "data_plane" {
  source   = "./modules/data-plane"
  env_name = var.env_name
  region   = var.region
}

########################################
# Module: ECR Repositories
########################################
module "ecr" {
  source   = "./modules/ecr"
  env_name = var.env_name
}

########################################
# Module: MCP Tools (Lambdas) — ported from CFN (Phase 2)
########################################
module "lambdas" {
  vton_alb_url          = var.vton_alb_url
  source                = "./modules/lambdas"
  env_name              = var.env_name
  region                = var.region
  table_names           = module.data_plane.table_names
  tryon_bucket          = module.data_plane.tryon_bucket_name
  product_images_bucket = module.data_plane.product_images_bucket_name
  vpc_id                = module.network.vpc_id
  private_subnet_ids    = module.network.private_subnet_ids
  mcp_source_root       = "${path.root}/../../components/mcp"

  # Long-term memory (S3 Vectors) — wires VECTOR_BUCKET/MEMORY_INDEX + IAM into memory-mcp.
  vector_bucket_name = module.memory_search.vector_bucket_name
  memory_index_name  = module.memory_search.index_name
}

########################################
# Module: Memory Search (Amazon S3 Vectors — long-term customer memory)
########################################
module "memory_search" {
  source   = "./modules/memory-search"
  env_name = var.env_name
  region   = var.region
}

########################################
# Module: Network (custom private VPC + endpoints) — D-019/D-027
########################################
module "network" {
  source       = "./modules/network"
  env_name     = var.env_name
  region       = var.region
  cluster_name = "storeai-${var.env_name}"
}

########################################
# Module: EKS (Auto Mode) — applied from Phase 2 (authored + plan-validated in Phase 1)
########################################
module "eks" {
  source                   = "./modules/eks"
  env_name                 = var.env_name
  region                   = var.region
  cluster_name             = "storeai-${var.env_name}"
  custom_domain            = var.custom_domain
  hosted_zone_id           = var.hosted_zone_id
  vpc_id                   = module.network.vpc_id
  private_subnet_ids       = module.network.private_subnet_ids
  private_subnet_ids_by_az = module.network.private_subnet_ids_by_az
  public_subnet_ids        = module.network.public_subnet_ids

  # Hybrid MNG accelerators (D-040). CB id seeds the SSM parameter on first apply;
  # thereafter update the SSM parameter out-of-band and re-apply.
  capacity_block_reservation_id = var.capacity_block_reservation_id
  capacity_block_az             = var.capacity_block_az
  capacity_block_instance_type  = var.capacity_block_instance_type
  capacity_block_ami_type       = var.capacity_block_ami_type
  gpu_mng_enabled               = var.gpu_mng_enabled
  gpu_node_desired              = var.gpu_node_desired
}

########################################
# Module: CDN (CloudFront + frontend S3 + ALB VPC origin) — Phase 2.5 / D-031
# Discovers the internal ALB (created by the orchestrator Ingress) by tag, so it
# must be applied AFTER the orchestrator is deployed.
########################################
module "cdn" {
  source       = "./modules/cdn"
  providers    = { aws = aws, aws.us_east_1 = aws.us_east_1 }
  env_name     = var.env_name
  region       = var.region
  alb_arn      = var.alb_arn
  alb_dns_name = var.alb_dns_name

  custom_domain  = var.custom_domain
  hosted_zone_id = var.hosted_zone_id
}

########################################
# Standalone image-edit endpoint DNS.
# CNAME hostname -> the image-edit Ingress ALB (created by the AWS LB Controller).
# Applied POST-k8s (needs the ALB DNS). The TLS cert reuses the eks wildcard
# (*.custom_domain) unless a BYO cert is provided. Destroyed on `storeai down`.
########################################
locals {
  image_edit_cert_arn = var.image_edit_cert_arn != "" ? var.image_edit_cert_arn : module.eks.acm_certificate_arn
}

resource "aws_route53_record" "image_edit" {
  count   = (var.image_edit_hostname != "" && var.image_edit_alb_dns_name != "") ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = var.image_edit_hostname
  type    = "CNAME"
  ttl     = 60
  records = [var.image_edit_alb_dns_name]
}
