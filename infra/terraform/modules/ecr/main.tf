########################################
# ECR — Container Image Repositories
########################################

locals {
  prefix = "storeai-${var.env_name}"

  # Container images built/pushed by the deployer. Extend as modules are added.
  # (LiteLLM is not built here — it is deployed from the official upstream Helm chart.)
  repos = toset([
    "orchestrator",
    "nova-sonic", # voice-nova (STT+TTS)
    "whisper",    # stt-whisper
    "liveavatar", # avatar-heygen
    "vton-fashn", # FASHN VTON (GPU)
    "vton",       # Qwen Image Edit (Neuron)
  ])

  tags = {
    Project     = "StoreAI"
    Environment = var.env_name
    ManagedBy   = "terraform"
  }
}

resource "aws_ecr_repository" "repos" {
  for_each = local.repos

  name         = "${local.prefix}-${each.key}"
  force_delete = true

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = local.tags
}

resource "aws_ecr_lifecycle_policy" "repos" {
  for_each   = local.repos
  repository = aws_ecr_repository.repos[each.key].name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 5 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 5
      }
      action = { type = "expire" }
    }]
  })
}
