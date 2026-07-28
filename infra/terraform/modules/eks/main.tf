########################################
# EKS — Auto Mode cluster, IAM, Pod Identity, subnet tagging
#
# Auto Mode manages general-purpose + system node pools automatically, plus a
# built-in ALB/Ingress controller and block storage. Per D-019/D-001:
#   - Capacity Block (Neuron) capacity is added in Phase 4 as an in-cluster
#     Auto Mode NodeClass (capacityReservationSelectorTerms) + NodePool
#     (capacity-type: reserved, capacity-reservation-type: capacity-block,
#     consolidateAfter: Never) — those are Kubernetes resources applied to the
#     live cluster (k8s/ manifests), NOT AWS resources, so they are not in this
#     module.
#   - Neuron DRA driver (K8s 1.34+) is likewise a Phase 4 in-cluster install.
########################################

data "aws_caller_identity" "current" {}

locals {
  tags    = { Project = "StoreAI", Environment = var.env_name, ManagedBy = "terraform" }
  has_dns = var.custom_domain != "" && var.hosted_zone_id != ""
}

########################################
# VPC / subnets come from the network module (D-027) — private-by-default topology.
# Subnet ELB tags are set by the network module.
########################################

########################################
# IAM — cluster role
########################################

resource "aws_iam_role" "cluster" {
  name = "${var.cluster_name}-cluster-role"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "eks.amazonaws.com" }, Action = ["sts:AssumeRole", "sts:TagSession"] }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "cluster" {
  for_each = toset([
    "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy",
    "arn:aws:iam::aws:policy/AmazonEKSComputePolicy",
    "arn:aws:iam::aws:policy/AmazonEKSNetworkingPolicy",
    "arn:aws:iam::aws:policy/AmazonEKSBlockStoragePolicy",
    "arn:aws:iam::aws:policy/AmazonEKSLoadBalancingPolicy",
  ])
  role       = aws_iam_role.cluster.name
  policy_arn = each.value
}

# The AWS-managed AmazonEKSLoadBalancingPolicy restricts ELB tag + rule ops via a
# ForAllValues:aws:TagKeys condition (only EKS-managed tag keys allowed). That
# blocks CreateRule/RemoveTags whenever any non-standard tag is present on the
# ALB/listener. This inline policy lets the Auto Mode LB controller manage its
# own ALB rules/tags unconditionally, so ingress reconciliation always completes (D-032).
resource "aws_iam_role_policy" "cluster_lb_tags_rules" {
  name = "storeai-lb-tags-rules"
  role = aws_iam_role.cluster.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "elasticloadbalancing:AddTags",
        "elasticloadbalancing:RemoveTags",
        "elasticloadbalancing:CreateRule",
        "elasticloadbalancing:DeleteRule",
        "elasticloadbalancing:ModifyRule",
        "ec2:CreateTags",
        "ec2:DeleteTags"
      ]
      Resource = "*"
    }]
  })
}

########################################
# IAM — Auto Mode node role
########################################

resource "aws_iam_role" "node_auto" {
  name = "${var.cluster_name}-node-auto-role"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "node_auto" {
  for_each = toset([
    "arn:aws:iam::aws:policy/AmazonEKSWorkerNodeMinimalPolicy",
    "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPullOnly",
  ])
  role       = aws_iam_role.node_auto.name
  policy_arn = each.value
}

########################################
# EKS cluster (Auto Mode)
########################################

resource "aws_eks_cluster" "main" {
  name                          = var.cluster_name
  role_arn                      = aws_iam_role.cluster.arn
  bootstrap_self_managed_addons = false

  access_config {
    authentication_mode = "API_AND_CONFIG_MAP"
  }

  compute_config {
    enabled       = true
    node_pools    = ["general-purpose", "system"]
    node_role_arn = aws_iam_role.node_auto.arn
  }

  kubernetes_network_config {
    elastic_load_balancing {
      enabled = true
    }
  }

  storage_config {
    block_storage {
      enabled = true
    }
  }

  vpc_config {
    subnet_ids              = concat(var.private_subnet_ids, var.public_subnet_ids)
    endpoint_public_access  = true
    endpoint_private_access = true
  }

  tags = local.tags

  depends_on = [aws_iam_role_policy_attachment.cluster]
}

########################################
# Deployer access entry (cluster admin)
########################################

resource "aws_eks_access_entry" "deployer" {
  cluster_name  = aws_eks_cluster.main.name
  principal_arn = data.aws_caller_identity.current.arn
  type          = "STANDARD"
}

resource "aws_eks_access_policy_association" "deployer_admin" {
  cluster_name  = aws_eks_cluster.main.name
  principal_arn = data.aws_caller_identity.current.arn
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
  access_scope { type = "cluster" }
}

########################################
# Pod Identity — Bedrock + Lambda for storeai-services SA (D-019/D-021)
########################################

resource "aws_iam_role" "voice_pod" {
  name = "${var.cluster_name}-pod-role"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "pods.eks.amazonaws.com" }, Action = ["sts:AssumeRole", "sts:TagSession"] }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy" "voice_pod_bedrock" {
  name = "bedrock-invoke"
  role = aws_iam_role.voice_pod.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "bedrock:InvokeModelWithBidirectionalStream"]
      # Least-privilege: all Anthropic Claude + Amazon Nova models (current and future),
      # via both the geo cross-region inference profiles (us./eu./apac.) and the underlying
      # foundation models in every destination Region (region wildcard). Covers the UI's chat
      # models (Claude Haiku/Sonnet/Opus, Nova Pro) and Nova Sonic voice. See the model list in
      # components/frontend and deploy/config/defaults.json.
      Resource = [
        "arn:aws:bedrock:*::foundation-model/anthropic.claude-*",
        "arn:aws:bedrock:*::foundation-model/amazon.nova-*",
        "arn:aws:bedrock:*:${data.aws_caller_identity.current.account_id}:inference-profile/*.anthropic.claude-*",
        "arn:aws:bedrock:*:${data.aws_caller_identity.current.account_id}:inference-profile/*.amazon.nova-*",
      ]
    }]
  })
}

resource "aws_iam_role_policy" "voice_pod_lambda" {
  name = "lambda-invoke"
  role = aws_iam_role.voice_pod.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = "arn:aws:lambda:${var.region}:${data.aws_caller_identity.current.account_id}:function:storeai-${var.env_name}-*"
    }]
  })
}

# Direct data-plane access for orchestrator endpoints that bypass MCP Lambdas:
# booth queue + chat history (DynamoDB), product/try-on images + VTON results (S3).
resource "aws_iam_role_policy" "voice_pod_dynamodb" {
  name = "dynamodb-access"
  role = aws_iam_role.voice_pod.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem",
        "dynamodb:Query", "dynamodb:Scan", "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem"
      ]
      Resource = [
        "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/storeai-${var.env_name}-*",
        "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/storeai-${var.env_name}-*/index/*"
      ]
    }]
  })
}

resource "aws_iam_role_policy" "voice_pod_s3" {
  name = "s3-access"
  role = aws_iam_role.voice_pod.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["s3:GetObject", "s3:PutObject", "s3:ListBucket"]
      Resource = [
        "arn:aws:s3:::storeai-${var.env_name}-*",
        "arn:aws:s3:::storeai-${var.env_name}-*/*"
      ]
    }]
  })
}

resource "aws_eks_addon" "pod_identity_agent" {
  cluster_name = aws_eks_cluster.main.name
  addon_name   = "eks-pod-identity-agent"
}

resource "aws_eks_pod_identity_association" "services" {
  cluster_name    = aws_eks_cluster.main.name
  namespace       = "default"
  service_account = "storeai-services"
  role_arn        = aws_iam_role.voice_pod.arn
  depends_on      = [aws_eks_addon.pod_identity_agent]
}

########################################
# Conditional ACM cert + DNS validation for services.<domain> (ALB TLS)
########################################

resource "aws_acm_certificate" "services" {
  count                     = local.has_dns ? 1 : 0
  domain_name               = var.custom_domain
  subject_alternative_names = ["*.${var.custom_domain}"]
  validation_method         = "DNS"
  tags                      = local.tags
  lifecycle { create_before_destroy = true }
}

resource "aws_route53_record" "cert_validation" {
  for_each = local.has_dns ? {
    for dvo in aws_acm_certificate.services[0].domain_validation_options : dvo.domain_name => {
      name = dvo.resource_record_name, type = dvo.resource_record_type, record = dvo.resource_record_value
    }
  } : {}
  zone_id         = var.hosted_zone_id
  name            = each.value.name
  type            = each.value.type
  ttl             = 60
  records         = [each.value.record]
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "services" {
  count                   = local.has_dns ? 1 : 0
  certificate_arn         = aws_acm_certificate.services[0].arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}
