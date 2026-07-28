########################################
# Hybrid Managed Node Groups for accelerators (D-040)
#   - Neuron (Trn2) Capacity Block MNG  — CB id from an SSM parameter (configurable)
#   - NVIDIA GPU MNG                    — on-demand, scale-to-zero capable
# Auto Mode's managed device plugins have gaps (NVIDIA time-slicing driver-injection
# D-039; Neuron Allocate timeout on Trn2), so accelerators run on MNG where we control
# the device-plugin/driver stack. General/Graviton workloads stay on Auto Mode.
########################################

########################################
# Capacity Block reservation id — configurable via SSM (updated out-of-band as CBs expire)
########################################
# TF owns the parameter so it always exists; `ignore_changes = [value]` means updating it
# with `aws ssm put-parameter --overwrite` (or deploy/modules/neuron.sh) persists across applies.
# The live value is read back via the data source below and drives MNG creation.
# TF owns the parameter so it always exists as the operator-facing knob; `ignore_changes = [value]`
# means updating it with `aws ssm put-parameter --overwrite` persists across applies.
# The deploy CLI resolves this SSM value into the `capacity_block_reservation_id` var at apply time
# (bridging SSM -> var keeps the MNG count plan-determinable). A fallback data source also reads it
# directly for pure-terraform use once the parameter exists.
resource "aws_ssm_parameter" "capacity_block_reservation_id" {
  name        = "/storeai-${var.env_name}/neuron/capacity_block_reservation_id"
  description = "Active Neuron Capacity Block reservation ID for the ${var.cluster_name} Trn2 MNG. Update with put-parameter when a new CB is launched, then re-apply."
  type        = "String"
  value       = var.capacity_block_reservation_id != "" ? var.capacity_block_reservation_id : "not-set"
  tags        = local.tags
  lifecycle {
    ignore_changes = [value]
  }
}

# Fallback read (only when the var is not supplied). Static name (not a resource ref) so it does not
# defer count to apply. On the very first apply supply the var (or pre-create the param).
data "aws_ssm_parameter" "capacity_block_reservation_id" {
  count = var.capacity_block_reservation_id == "" ? 1 : 0
  name  = "/storeai-${var.env_name}/neuron/capacity_block_reservation_id"
}

# Neuron MNG placement: pick the private subnet in the CB's AZ from the network
# module's az->subnet map. Keys are known at plan time, so no data-source for_each
# over unknown subnet ids (which fails on a fresh apply).
locals {
  cb_val         = var.capacity_block_reservation_id != "" ? var.capacity_block_reservation_id : try(trimspace(data.aws_ssm_parameter.capacity_block_reservation_id[0].value), "")
  cb_id_resolved = (local.cb_val != "" && local.cb_val != "not-set") ? local.cb_val : ""
  cb_enabled     = local.cb_id_resolved != ""
  cb_subnet_ids = (var.capacity_block_az != "" && lookup(var.private_subnet_ids_by_az, var.capacity_block_az, "") != "") ? [
    var.private_subnet_ids_by_az[var.capacity_block_az]
  ] : var.private_subnet_ids
  any_mng = var.gpu_mng_enabled || local.cb_enabled

  # cloud-boothook: RAID0 the NVMe instance store and bind-mount containerd + /models onto it
  # (accelerator container images + baked/compiled model weights are large). Runs before nodeadm.
  nvme_user_data = base64encode(<<-EOF
    MIME-Version: 1.0
    Content-Type: multipart/mixed; boundary="BOUNDARY"

    --BOUNDARY
    Content-Type: text/cloud-boothook; charset="us-ascii"

    #!/bin/bash
    set -ex
    NVME_DEVS=$(lsblk -dpno NAME,MODEL | grep "Instance Storage" | awk '{print $1}')
    if [ -n "$NVME_DEVS" ]; then
      DEV_COUNT=$(echo "$NVME_DEVS" | wc -l)
      if [ "$DEV_COUNT" -gt 1 ]; then
        mdadm --create /dev/md0 --level=0 --raid-devices=$DEV_COUNT $NVME_DEVS
        mkfs.xfs /dev/md0; MOUNT_DEV=/dev/md0
      else
        mkfs.xfs -f $NVME_DEVS; MOUNT_DEV=$NVME_DEVS
      fi
      mkdir -p /mnt/nvme; mount $MOUNT_DEV /mnt/nvme
      mkdir -p /mnt/nvme/containerd /mnt/nvme/models
      cp -a /var/lib/containerd/. /mnt/nvme/containerd/ 2>/dev/null || true
      mount --bind /mnt/nvme/containerd /var/lib/containerd
      ln -sfn /mnt/nvme/models /models
    fi
    --BOUNDARY--
  EOF
  )
}

########################################
# IAM — managed node group worker role (cannot reuse the Auto Mode node role)
########################################
resource "aws_iam_role" "node_managed" {
  name = "${var.cluster_name}-node-managed-role"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "node_managed" {
  for_each = toset([
    "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",
    "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",
    "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
    "arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess",
    "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
  ])
  role       = aws_iam_role.node_managed.name
  policy_arn = each.value
}

# Write access to the TF-managed Neuron cache bucket (compile artifacts + base models).
resource "aws_iam_role_policy" "node_managed_s3_write" {
  name = "s3-model-write"
  role = aws_iam_role.node_managed.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["s3:PutObject", "s3:DeleteObject"]
      Resource = [
        "${aws_s3_bucket.neuron_cache.arn}/*",
      ]
    }]
  })
}

# TF-managed cache bucket for compiled Neuron artifacts (Trn2). Inference pods download the
# compiled model from here on start (skipping the 20-40 min recompile) and upload it after a
# cold compile. Per-model/instance prefixes, e.g. qwen3-8b/trn2/ , vton-qwen/trn2/.
resource "aws_s3_bucket" "neuron_cache" {
  bucket        = "storeai-${var.env_name}-neuron-cache-${data.aws_caller_identity.current.account_id}"
  force_destroy = true
  tags          = local.tags
}

# Block all public access — the compile cache is read/written only by cluster pods via IAM (CKV2_AWS_6).
resource "aws_s3_bucket_public_access_block" "neuron_cache" {
  bucket                  = aws_s3_bucket.neuron_cache.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "neuron_cache" {
  bucket = aws_s3_bucket.neuron_cache.id
  rule {
    id     = "expire-stale-compile-caches"
    status = "Enabled"
    filter {}
    expiration { days = 90 }
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }
}

# MNG nodes join via an EC2_LINUX access entry (Auto Mode uses an implicit entry from compute_config).
resource "aws_eks_access_entry" "node_managed" {
  count         = local.any_mng ? 1 : 0
  cluster_name  = aws_eks_cluster.main.name
  principal_arn = aws_iam_role.node_managed.arn
  type          = "EC2_LINUX"
}

########################################
# Add-ons required for MNG nodes (Auto Mode runs these off-cluster for its own nodes).
# AWS-enhanced add-ons carry anti-affinity on eks.amazonaws.com/compute-type=auto, so their
# pods run ONLY on MNG nodes and never disturb Auto Mode nodes.
########################################
resource "aws_eks_addon" "vpc_cni" {
  count                       = local.any_mng ? 1 : 0
  cluster_name                = aws_eks_cluster.main.name
  addon_name                  = "vpc-cni"
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"
  tags                        = local.tags
}

resource "aws_eks_addon" "kube_proxy" {
  count                       = local.any_mng ? 1 : 0
  cluster_name                = aws_eks_cluster.main.name
  addon_name                  = "kube-proxy"
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"
  tags                        = local.tags
}

resource "aws_eks_addon" "coredns" {
  count                       = local.any_mng ? 1 : 0
  cluster_name                = aws_eks_cluster.main.name
  addon_name                  = "coredns"
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"
  tags                        = local.tags
}

########################################
# GPU (NVIDIA) managed node group — on-demand, scale-to-zero capable.
# Taint keeps general Auto Mode pods off; GPU workloads add matching tolerations.
########################################
resource "aws_launch_template" "gpu" {
  count         = var.gpu_mng_enabled ? 1 : 0
  name_prefix   = "${var.cluster_name}-gpu-"
  instance_type = var.gpu_instance_type
  user_data     = local.nvme_user_data

  metadata_options {
    http_endpoint               = "enabled"
    http_put_response_hop_limit = 2
    http_tokens                 = "required"
  }
  tag_specifications {
    resource_type = "instance"
    tags          = merge(local.tags, { Name = "${var.cluster_name}-gpu" })
  }
}

resource "aws_eks_node_group" "gpu" {
  count           = var.gpu_mng_enabled ? 1 : 0
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = "${var.cluster_name}-gpu"
  node_role_arn   = aws_iam_role.node_managed.arn
  subnet_ids      = var.private_subnet_ids
  ami_type        = var.gpu_ami_type
  capacity_type   = "ON_DEMAND"

  launch_template {
    id      = aws_launch_template.gpu[0].id
    version = aws_launch_template.gpu[0].latest_version
  }

  scaling_config {
    desired_size = var.gpu_node_desired
    min_size     = var.gpu_node_min
    max_size     = var.gpu_node_max
  }

  labels = { "storeai/accelerator" = "nvidia" }

  taint {
    key    = "nvidia.com/gpu"
    value  = "true"
    effect = "NO_SCHEDULE"
  }

  lifecycle {
    ignore_changes = [scaling_config[0].desired_size] # allow out-of-band scale-to-zero
  }

  depends_on = [
    aws_iam_role_policy_attachment.node_managed,
    aws_eks_access_entry.node_managed,
    aws_eks_addon.vpc_cni,
    aws_eks_addon.kube_proxy,
  ]
}

########################################
# Neuron (Trn2) Capacity Block managed node group — created only when the SSM CB id is set.
########################################
resource "aws_launch_template" "neuron_cb" {
  count         = local.cb_enabled ? 1 : 0
  name_prefix   = "${var.cluster_name}-neuron-cb-"
  instance_type = var.capacity_block_instance_type
  user_data     = local.nvme_user_data

  instance_market_options {
    market_type = "capacity-block"
  }
  capacity_reservation_specification {
    capacity_reservation_target {
      capacity_reservation_id = local.cb_id_resolved
    }
  }
  metadata_options {
    http_endpoint               = "enabled"
    http_put_response_hop_limit = 2
    http_tokens                 = "required"
  }
  tag_specifications {
    resource_type = "instance"
    tags          = merge(local.tags, { Name = "${var.cluster_name}-neuron-cb" })
  }
}

resource "aws_eks_node_group" "neuron_cb" {
  count           = local.cb_enabled ? 1 : 0
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = "${var.cluster_name}-neuron-cb"
  node_role_arn   = aws_iam_role.node_managed.arn
  subnet_ids      = local.cb_subnet_ids
  ami_type        = var.capacity_block_ami_type
  capacity_type   = "CAPACITY_BLOCK"

  launch_template {
    id      = aws_launch_template.neuron_cb[0].id
    version = aws_launch_template.neuron_cb[0].latest_version
  }

  scaling_config {
    desired_size = var.capacity_block_node_count
    min_size     = var.capacity_block_node_count
    max_size     = var.capacity_block_node_count
  }

  labels = {
    "storeai/accelerator" = "neuron"
    "storeai/instance"    = var.capacity_block_instance_type
  }

  taint {
    key    = "aws.amazon.com/neuron"
    value  = "true"
    effect = "NO_SCHEDULE"
  }

  depends_on = [
    aws_iam_role_policy_attachment.node_managed,
    aws_eks_access_entry.node_managed,
    aws_eks_addon.vpc_cni,
    aws_eks_addon.kube_proxy,
  ]
}

output "node_managed_role_arn" {
  value = aws_iam_role.node_managed.arn
}

output "neuron_cb_nodegroup_name" {
  value = local.cb_enabled ? aws_eks_node_group.neuron_cb[0].node_group_name : ""
}

output "gpu_nodegroup_name" {
  value = var.gpu_mng_enabled ? aws_eks_node_group.gpu[0].node_group_name : ""
}

output "capacity_block_ssm_param" {
  value = aws_ssm_parameter.capacity_block_reservation_id.name
}

output "neuron_cache_bucket" {
  value = aws_s3_bucket.neuron_cache.bucket
}
