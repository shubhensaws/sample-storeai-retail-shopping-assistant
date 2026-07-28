terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
      # us_east_1 is used only for the CloudFront viewer ACM certificate, which
      # must be created in us-east-1 regardless of the app region.
      configuration_aliases = [aws.us_east_1]
    }
  }
}
