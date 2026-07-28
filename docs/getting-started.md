# Getting started

This guide walks you through deploying StoreAI to your own AWS account for the first time. The full
deployment takes roughly 20–40 minutes, most of which is unattended.

## Prerequisites

### AWS account and credentials

- An AWS account with permission to create EKS, Lambda, DynamoDB, S3, CloudFront, IAM, and VPC
  resources.
- The AWS CLI configured with credentials (`aws sts get-caller-identity` must succeed).
- StoreAI uses **Anthropic Claude and Amazon Nova models** through Amazon Bedrock. The default region
  is `us-east-2`.
- **Enable Bedrock model access.** Bedrock does not grant model access automatically. In the AWS
  console, open **Bedrock → Model access** and enable Anthropic Claude and Amazon Nova for your
  account and region before deploying — this is a common first-time blocker.

### A Terraform state bucket (the one required input)

StoreAI manages every AWS resource with Terraform. The **only** piece of infrastructure you provide
yourself is an S3 bucket to hold Terraform state:

```bash
aws s3 mb s3://<your-terraform-state-bucket>
```

You pass its name in the configuration (`global.tfStateBucket`). The deployer validates that the
bucket exists but never creates or deletes it. See [design-decisions.md](design-decisions.md) (D-013)
for the reasoning.

### Local tools

Install these before deploying. The deployer runs a preflight check and tells you if any are missing.

| Tool | Purpose |
|------|---------|
| `terraform` | Provisions all AWS infrastructure |
| `aws` (CLI v2) | AWS API access |
| `kubectl` | Deploys workloads to EKS |
| `helm` (v3) | Installs the LiteLLM gateway |
| `docker` or `podman` (with `buildx`) | Builds container images |
| `node` / `npm` (18+) | Builds the frontend |
| `python3` (3.11+) | Config and seed scripts |
| `envsubst`, `jq` | Manifest templating and JSON handling |

On macOS:

```bash
brew install terraform awscli kubectl helm node python@3.11 jq gettext
```

### Optional prerequisites

You only need these for specific features (all are off by default):

- **AWS Trainium capacity block** — required only to self-host the LLM or the Qwen Image-Edit try-on
  model. See [self-hosted-models.md](self-hosted-models.md).
- **HeyGen API key** — required only for the animated avatar.
- **Custom domain and Route 53 hosted zone** — optional; without them, StoreAI uses the default
  CloudFront domain.

### A note on cost

The default deployment runs an EKS cluster, a NAT gateway, and several Lambdas, so it incurs on-demand
AWS infrastructure cost even when idle (roughly a few dollars per day), plus per-request model
inference on Bedrock. Accelerator workloads (GPU/Trainium) scale to zero when unused. Use the
[AWS Pricing Calculator](https://calculator.aws/) and Cost Explorer for figures specific to your
account and region.

## Step 1: Create your configuration

StoreAI is driven by a single file, `storeai.config.json`. Generate one interactively:

```bash
./deploy/storeai config init --interactive
```

Or accept the defaults non-interactively:

```bash
./deploy/storeai config init
```

You can also build the file visually by opening `deploy/ui/index.html` in a browser. All three
methods produce the same file. Every setting is documented in [configuration.md](configuration.md).

Or copy the checked-in template and edit it by hand:

```bash
cp storeai.config.example.json storeai.config.json
# then edit storeai.config.json — at minimum set global.tfStateBucket
```

`storeai.config.example.json` is a sanitized template that is committed to the repo.
`storeai.config.json` holds your real values and is **git-ignored** — it is never committed, so your
account ID, domains, capacity-block IDs, and credentials stay local. If you cloned a fresh copy of
this repo, `storeai.config.json` will not exist yet; create it with one of the methods above.

At minimum, set your Terraform state bucket:

```json
{ "global": { "tfStateBucket": "your-terraform-state-bucket", "region": "us-east-2", "env": "dev" } }
```

The deployer reads `deploy/config/defaults.json` unless you point it at your file, so pass it
explicitly (or export `STOREAI_CONFIG`):

```bash
./deploy/storeai up --config storeai.config.json
# or:  STOREAI_CONFIG=storeai.config.json ./deploy/storeai up
```

## Step 2: Preview the deployment (optional)

```bash
./deploy/storeai plan
```

This runs `terraform plan` and prints the resolved module order without changing anything.

## Step 3: Deploy

```bash
./deploy/storeai up
```

The deployer:

1. Runs preflight checks (tools, credentials, config validity, state bucket).
2. Applies the Terraform infrastructure (network, EKS, data plane, ECR, Lambdas).
3. Bootstraps the cluster and installs the LiteLLM gateway.
4. Builds and deploys the application services.
5. Seeds the sample product catalog and creates the CloudFront distribution.

When it finishes, it prints your store URL:

```
StoreAI is live: https://d1234abcdef.cloudfront.net
```

### Deploy a single capability

Every module can be deployed on its own; the deployer automatically brings up its dependencies. For
example, to deploy only the generic image-edit model:

```bash
./deploy/storeai up --module image-edit-model
```

See the standalone use cases in [architecture.md](architecture.md#modules).

## Step 4: Sign in

The deployment creates the admin sign-in user in Amazon Cognito (the `cognito-user` module) — **no
password is ever stored in config**. Which path runs depends on `prerequisites.auth.adminEmail`:

- **A real email** — Cognito emails a one-time invitation; sign in with the temporary password from
  that email and you'll be prompted to set your own.
- **Blank (default)** — creates `admin@storeai.local` with **no password**; the deployer prints a
  ready-to-run CLI command to set one (or use the Cognito console), then sign in.

See [configuration.md](configuration.md) for details.

## Tear down

Remove everything StoreAI created (your Terraform state bucket is preserved):

```bash
./deploy/storeai down --all
```

To remove a single module and nothing that depends on it:

```bash
./deploy/storeai down --module avatar-heygen
```

## Check status

```bash
./deploy/storeai status
```

## Next steps

- Understand the system: [architecture.md](architecture.md)
- Tune every setting: [configuration.md](configuration.md)
- Self-host models on Trainium/GPU: [self-hosted-models.md](self-hosted-models.md)
- Hit a problem? [troubleshooting.md](troubleshooting.md)
